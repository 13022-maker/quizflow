'use server';

/**
 * 適性學習（Adaptive Learning）Server Actions — 教師端
 * 老師建立「適性練習」（選學科＋命名）→ 取得分享連結（accessCode）發給學生。
 * 學科來源：內建（cpp/python/calculus）或老師 AI 生成的自建學科（subjectId = "db:<id>"）。
 * 學生端走公開 API（/api/adaptive/[code]/*），不經過這裡。
 */
import { auth } from '@clerk/nextjs/server';
import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { generateSubject, toSubject } from '@/libs/adaptive/generate-subject';
import { DB_SUBJECT_PREFIX } from '@/libs/adaptive/service';
import { listSubjects } from '@/libs/adaptive/subjects';
import { db } from '@/libs/DB';
import { adaptivePracticeSchema, adaptiveSubjectSchema } from '@/models/Schema';

const createPracticeSchema = z.object({
  title: z.string().trim().min(1, '請輸入練習名稱').max(100),
  subjectId: z.string().min(1),
});

/**
 * 老師可選用的學科清單：內建三科 ＋ 自己 AI 生成的學科。
 * 建練習的下拉選單與驗證都用它（自建學科帶 db: 前綴的 id）。
 */
export async function listAvailableSubjects(): Promise<{ id: string; name: string }[]> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('請先登入');
  }

  const builtIn = listSubjects().map(s => ({ id: s.id, name: s.name }));
  const custom = await db
    .select({ id: adaptiveSubjectSchema.id, name: adaptiveSubjectSchema.name })
    .from(adaptiveSubjectSchema)
    .where(eq(adaptiveSubjectSchema.ownerId, userId))
    .orderBy(desc(adaptiveSubjectSchema.createdAt));

  return [
    ...builtIn,
    ...custom.map(c => ({ id: `${DB_SUBJECT_PREFIX}${c.id}`, name: `${c.name}（我的）` })),
  ];
}

/** 驗證 subjectId 是老師可用的學科（內建，或自己擁有的自建學科） */
async function assertSubjectUsable(subjectId: string, userId: string): Promise<void> {
  if (!subjectId.startsWith(DB_SUBJECT_PREFIX)) {
    if (!listSubjects().some(s => s.id === subjectId)) {
      throw new Error(`學科不存在：${subjectId}`);
    }
    return;
  }
  const id = Number(subjectId.slice(DB_SUBJECT_PREFIX.length));
  const [row] = await db
    .select({ ownerId: adaptiveSubjectSchema.ownerId })
    .from(adaptiveSubjectSchema)
    .where(eq(adaptiveSubjectSchema.id, id));
  if (!row || row.ownerId !== userId) {
    throw new Error('學科不存在或非本人建立');
  }
}

/** 建立適性練習：分享碼用 8 碼 nanoid（防循序猜測），成功後導向儀表板 */
export async function createAdaptivePractice(formData: FormData) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('請先登入');
  }

  const parsed = createPracticeSchema.parse({
    title: formData.get('title'),
    subjectId: formData.get('subjectId'),
  });
  await assertSubjectUsable(parsed.subjectId, userId);

  const [practice] = await db
    .insert(adaptivePracticeSchema)
    .values({
      ownerId: userId,
      subjectId: parsed.subjectId,
      title: parsed.title,
      accessCode: nanoid(8),
    })
    .returning();

  revalidatePath('/dashboard/adaptive');
  redirect(`/dashboard/adaptive/${practice!.id}`);
}

/** 刪除適性練習（連同學生狀態與事件，schema 已設 onDelete: cascade） */
export async function deleteAdaptivePractice(practiceId: number) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('請先登入');
  }

  await db
    .delete(adaptivePracticeSchema)
    .where(
      and(
        eq(adaptivePracticeSchema.id, practiceId),
        eq(adaptivePracticeSchema.ownerId, userId), // 只能刪自己的
      ),
    );

  revalidatePath('/dashboard/adaptive');
}

const generateSubjectSchema = z.object({
  topic: z.string().trim().min(2, '請輸入單元主題').max(100),
  material: z.string().trim().max(20000).optional(),
});

/**
 * AI 生成一個新學科並存入 adaptive_subject。
 * 回傳結果給前端（不 redirect，讓生成頁顯示成功摘要與學科 id）。
 */
export async function generateAdaptiveSubject(
  input: { topic: string; material?: string },
): Promise<
  { id: number; name: string; knowledgeCount: number; itemCount: number } | { error: string }
  > {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('請先登入');
  }

  const parsed = generateSubjectSchema.parse(input);

  // 呼叫 AI 生成（含結構＋語意＋引擎建構三道驗證，失敗自動重試一次）
  let generated: Awaited<ReturnType<typeof generateSubject>>;
  try {
    generated = await generateSubject(parsed.topic, parsed.material);
  } catch (err) {
    // 兩個 AI provider 都失敗（或模型拒絕）：回傳友善錯誤，不讓例外冒泡成整頁 digest error
    console.error('[generateAdaptiveSubject] AI 生成失敗：', err);
    const msg = err instanceof Error ? err.message : '';
    // Claude 的拒絕/截斷訊息照實顯示；Gemini 對應的 SAFETY / MAX_TOKENS 轉成等義的可行動訊息
    let friendly = 'AI 服務暫時無法使用，請稍後再試';
    if (msg.includes('拒絕') || msg.includes('SAFETY')) {
      friendly = '模型拒絕生成此主題的內容，請換一個主題';
    } else if (msg.includes('截斷') || msg.includes('MAX_TOKENS')) {
      friendly = '生成內容過長被截斷，請縮小主題範圍再試';
    }
    return { error: friendly } as const;
  }
  const { subject } = toSubject(generated, 'pending'); // 取正規化後的 graph/itemBank/tutor

  const [row] = await db
    .insert(adaptiveSubjectSchema)
    .values({
      ownerId: userId,
      name: generated.name,
      sourceTopic: parsed.topic,
      graph: subject.graph,
      itemBank: subject.itemBank,
      tutor: subject.tutor,
    })
    .returning();

  revalidatePath('/dashboard/adaptive');
  return {
    id: row!.id,
    name: row!.name,
    knowledgeCount: subject.graph.nodes.length,
    itemCount: subject.itemBank.items.length,
  };
}
