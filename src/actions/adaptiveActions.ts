'use server';

/**
 * 適性學習（Adaptive Learning）Server Actions — 教師端
 * 老師建立「適性練習」（選學科＋命名）→ 取得分享連結（accessCode）發給學生。
 * 學科來源：內建（cpp/python/calculus）或老師 AI 生成的自建學科（subjectId = "db:<id>"）。
 * 學生端走公開 API（/api/adaptive/[code]/*），不經過這裡。
 */
import { auth } from '@clerk/nextjs/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { friendlyAIGenerationError, generateSubject, toSubject } from '@/libs/adaptive/generate-subject';
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
 * group 供下拉選單分組（<optgroup>）用；pinned 供釘選學科加 📌 前綴用。
 */
export async function listAvailableSubjects(): Promise<{
  id: string;
  name: string;
  group: 'built-in' | 'custom';
  pinned: boolean;
}[]> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('請先登入');
  }

  const builtIn = listSubjects().map(s => ({
    id: s.id,
    name: s.name,
    group: 'built-in' as const,
    pinned: false,
  }));
  const custom = await db
    .select({
      id: adaptiveSubjectSchema.id,
      name: adaptiveSubjectSchema.name,
      pinned: adaptiveSubjectSchema.pinned,
    })
    .from(adaptiveSubjectSchema)
    .where(
      and(
        eq(adaptiveSubjectSchema.ownerId, userId),
        isNull(adaptiveSubjectSchema.archivedAt), // 已封存的不進下拉選單
      ),
    )
    .orderBy(desc(adaptiveSubjectSchema.pinned), desc(adaptiveSubjectSchema.createdAt)); // 釘選優先，其餘新到舊

  return [
    ...builtIn,
    ...custom.map(c => ({
      id: `${DB_SUBJECT_PREFIX}${c.id}`,
      name: c.name,
      group: 'custom' as const,
      pinned: c.pinned,
    })),
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

export const generateSubjectSchema = z.object({
  topic: z.string().trim().min(2, '請輸入單元主題').max(100),
  material: z.string().trim().max(20000).optional(),
});

type SavedSubjectResult = {
  id: number;
  name: string;
  knowledgeCount: number;
  itemCount: number;
};

/**
 * 把 AI 生成結果（GeneratedSubject）寫入 adaptive_subject，並讓學科清單頁重新驗證快取。
 * 文字模式（generateAdaptiveSubject，本檔案）與檔案上傳模式
 * （/api/ai/generate-subject-from-file）共用，避免存檔邏輯寫兩份。
 */
export async function saveGeneratedSubject(
  userId: string,
  topic: string,
  generated: Awaited<ReturnType<typeof generateSubject>>,
): Promise<SavedSubjectResult> {
  // 這個函式是 'use server' 檔案的獨立可呼叫端點，不能只信任傳入的 userId 參數，
  // 必須在函式內部重新驗證登入身份，避免被當成 RPC 帶偽造 userId 呼叫，寫入別人帳號底下
  const { userId: authedUserId } = await auth();
  if (!authedUserId || authedUserId !== userId) {
    throw new Error('未授權：userId 與登入身份不符');
  }

  const { subject } = toSubject(generated, 'pending'); // 取正規化後的 graph/itemBank/tutor

  const [row] = await db
    .insert(adaptiveSubjectSchema)
    .values({
      ownerId: userId,
      name: generated.name,
      sourceTopic: topic,
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

/**
 * AI 生成一個新學科並存入 adaptive_subject。
 * 回傳結果給前端（不 redirect，讓生成頁顯示成功摘要與學科 id）。
 */
export async function generateAdaptiveSubject(
  input: { topic: string; material?: string },
): Promise<SavedSubjectResult | { error: string }> {
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
    return { error: friendlyAIGenerationError(err) } as const;
  }

  return saveGeneratedSubject(userId, parsed.topic, generated);
}

/**
 * 學科管理頁（/dashboard/adaptive/subjects）用：回傳老師自己全部自建學科（含已封存），
 * 附帶知識點數／題目數，只列自建學科，內建三科不在管理範圍內。
 */
export async function listMySubjectsForManagement(): Promise<{
  id: number;
  name: string;
  sourceTopic: string;
  pinned: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  knowledgeCount: number;
  itemCount: number;
}[]> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('請先登入');
  }

  const rows = await db
    .select()
    .from(adaptiveSubjectSchema)
    .where(eq(adaptiveSubjectSchema.ownerId, userId))
    .orderBy(desc(adaptiveSubjectSchema.pinned), desc(adaptiveSubjectSchema.createdAt));

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    sourceTopic: r.sourceTopic,
    pinned: r.pinned,
    archivedAt: r.archivedAt,
    createdAt: r.createdAt,
    knowledgeCount: r.graph.nodes.length,
    itemCount: r.itemBank.items.length,
  }));
}

/** 驗證是本人擁有的自建學科，回傳該 row（給 rename/pin/archive/delete 共用） */
async function assertOwnSubject(subjectId: number, userId: string) {
  const [row] = await db
    .select({ id: adaptiveSubjectSchema.id, ownerId: adaptiveSubjectSchema.ownerId })
    .from(adaptiveSubjectSchema)
    .where(eq(adaptiveSubjectSchema.id, subjectId));
  if (!row || row.ownerId !== userId) {
    throw new Error('學科不存在或非本人建立');
  }
}

const renameSubjectSchema = z.object({
  name: z.string().trim().min(1, '請輸入學科名稱').max(100),
});

/** 重新命名自建學科 */
export async function renameAdaptiveSubject(subjectId: number, name: string) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('請先登入');
  }
  await assertOwnSubject(subjectId, userId);
  const parsed = renameSubjectSchema.parse({ name });

  await db
    .update(adaptiveSubjectSchema)
    .set({ name: parsed.name })
    .where(and(eq(adaptiveSubjectSchema.id, subjectId), eq(adaptiveSubjectSchema.ownerId, userId)));

  revalidatePath('/dashboard/adaptive');
  revalidatePath('/dashboard/adaptive/subjects');
}

/** 釘選／取消釘選自建學科：排到下拉選單與管理頁最前面 */
export async function setAdaptiveSubjectPinned(subjectId: number, pinned: boolean) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('請先登入');
  }
  await assertOwnSubject(subjectId, userId);

  await db
    .update(adaptiveSubjectSchema)
    .set({ pinned })
    .where(and(eq(adaptiveSubjectSchema.id, subjectId), eq(adaptiveSubjectSchema.ownerId, userId)));

  revalidatePath('/dashboard/adaptive');
  revalidatePath('/dashboard/adaptive/subjects');
}

/** 封存自建學科：從「建立新練習」下拉選單隱藏，既有練習不受影響（resolveSubject 不看這個欄位） */
export async function archiveAdaptiveSubject(subjectId: number) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('請先登入');
  }
  await assertOwnSubject(subjectId, userId);

  await db
    .update(adaptiveSubjectSchema)
    .set({ archivedAt: new Date() })
    .where(and(eq(adaptiveSubjectSchema.id, subjectId), eq(adaptiveSubjectSchema.ownerId, userId)));

  revalidatePath('/dashboard/adaptive');
  revalidatePath('/dashboard/adaptive/subjects');
}

/** 取消封存：重新出現在下拉選單 */
export async function unarchiveAdaptiveSubject(subjectId: number) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('請先登入');
  }
  await assertOwnSubject(subjectId, userId);

  await db
    .update(adaptiveSubjectSchema)
    .set({ archivedAt: null })
    .where(and(eq(adaptiveSubjectSchema.id, subjectId), eq(adaptiveSubjectSchema.ownerId, userId)));

  revalidatePath('/dashboard/adaptive');
  revalidatePath('/dashboard/adaptive/subjects');
}

/**
 * 刪除自建學科。adaptive_practice.subject_id 沒有外鍵約束，
 * 若貿然刪除已被練習使用的學科，該練習的班級儀表板會直接壞掉（resolveSubject 找不到列）。
 * 因此刪除前先檢查是否已有練習在用，有的話拒絕並請老師改用封存。
 */
export async function deleteAdaptiveSubject(subjectId: number): Promise<{ error?: string }> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('請先登入');
  }
  await assertOwnSubject(subjectId, userId);

  const dbSubjectId = `${DB_SUBJECT_PREFIX}${subjectId}`;
  const usedByPractices = await db
    .select({ id: adaptivePracticeSchema.id })
    .from(adaptivePracticeSchema)
    .where(eq(adaptivePracticeSchema.subjectId, dbSubjectId));

  if (usedByPractices.length > 0) {
    return { error: `此學科已建立 ${usedByPractices.length} 個練習，無法刪除，請改用封存` };
  }

  await db
    .delete(adaptiveSubjectSchema)
    .where(and(eq(adaptiveSubjectSchema.id, subjectId), eq(adaptiveSubjectSchema.ownerId, userId)));

  revalidatePath('/dashboard/adaptive');
  revalidatePath('/dashboard/adaptive/subjects');
  return {};
}
