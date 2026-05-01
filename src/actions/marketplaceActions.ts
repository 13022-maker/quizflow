'use server';

import { auth } from '@clerk/nextjs/server';
import { and, count, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { ensureUniqueSlug, generateSlug } from '@/lib/slug';
import { db } from '@/libs/DB';
import {
  assertCanFork,
  ForkError,
  generateRoomCode,
} from '@/libs/fork';
import { insertForkedQuiz, loadSourceQuiz } from '@/libs/fork-dao';
import { questionSchema, quizSchema, vocabCardSchema, vocabSetSchema } from '@/models/Schema';

const PublishSchema = z.object({
  quizId: z.number(),
  category: z.string().min(1),
  gradeLevel: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

export async function publishToMarketplace(data: z.infer<typeof PublishSchema>) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('未登入');
  }

  const parsed = PublishSchema.safeParse(data);
  if (!parsed.success) {
    return { error: '請填寫完整資訊' };
  }

  const [quiz] = await db
    .select({
      id: quizSchema.id,
      status: quizSchema.status,
      ownerId: quizSchema.ownerId,
      slug: quizSchema.slug,
      publishedAt: quizSchema.publishedAt,
    })
    .from(quizSchema)
    .where(and(eq(quizSchema.id, parsed.data.quizId), eq(quizSchema.ownerId, userId)))
    .limit(1);

  if (!quiz) {
    return { error: '找不到測驗或無權限' };
  }
  if (quiz.status !== 'published') {
    return { error: '請先發佈測驗再分享到市集' };
  }

  const [qCount] = await db
    .select({ total: count() })
    .from(questionSchema)
    .where(eq(questionSchema.quizId, parsed.data.quizId));

  if (!qCount?.total) {
    return { error: '測驗沒有題目，無法分享' };
  }

  // 漸進整合 visibility(Phase 1 commit 2):marketplace 上架 = visibility='public'
  // slug / publishedAt 若空則自動產(跟 setQuizVisibility 行為一致)
  const slug = quiz.slug ?? (await ensureUniqueSlug(generateSlug(), parsed.data.quizId));
  const publishedAt = quiz.publishedAt ?? new Date();

  await db
    .update(quizSchema)
    .set({
      visibility: 'public',
      slug,
      publishedAt,
      category: parsed.data.category,
      gradeLevel: parsed.data.gradeLevel,
      tags: parsed.data.tags,
    })
    .where(eq(quizSchema.id, parsed.data.quizId));

  revalidatePath('/marketplace');
  revalidatePath(`/dashboard/quizzes/${parsed.data.quizId}/edit`);
  return { success: true };
}

export async function unpublishFromMarketplace(quizId: number) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('未登入');
  }

  // 漸進整合 visibility(Phase 1 commit 2):下架 = visibility='private'
  // slug / publishedAt 保留(避免 break 既有分享連結)
  await db
    .update(quizSchema)
    .set({ visibility: 'private' })
    .where(and(eq(quizSchema.id, quizId), eq(quizSchema.ownerId, userId)));

  revalidatePath('/marketplace');
  revalidatePath(`/dashboard/quizzes/${quizId}/edit`);
}

/**
 * 從 marketplace 複製測驗（Server Action,給 /marketplace 頁面用）。
 *
 * 共用 fork.ts / fork-dao.ts 核心，與 /api/quizzes/[id]/fork API route 行為一致：
 *   - aiHint 拷貝（修既有漏拷 bug）
 *   - 全程 db.transaction（修既有 orphan quiz bug）
 *   - 不繼承 publisherId / isbn / chapter / bookTitle
 *   - title 加「（副本）」後綴
 *   - 公開連結 visibility='unlisted' 也允許複製（Phase 1 commit 2 Q2）
 *
 * 與 API route 唯一差異：**plan check 不啟用**（傳 isPro=true 跳過）
 *   → 保留 Free 用戶的「市集免費複製範本」成長路徑
 *   → Pro only 限制只在 API route 啟用（給 mobile / 第三方用）
 */
export async function copyQuizFromMarketplace(sourceQuizId: number) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('請先登入再複製');
  }

  const source = await loadSourceQuiz(sourceQuizId);

  try {
    // isPro=true 跳過 plan gate;其他規則(not-found / self-fork / visibility)照常
    assertCanFork(source, userId, true);

    const { newQuizId } = await insertForkedQuiz({
      source,
      ownerId: userId,
      codes: { accessCode: nanoid(8), roomCode: generateRoomCode() },
    });

    revalidatePath('/marketplace');
    revalidatePath('/dashboard/quizzes');
    return { success: true, newQuizId };
  } catch (e) {
    if (e instanceof ForkError) {
      return { error: e.message };
    }
    throw e;
  }
}

// ===== 單字卡集（vocab）市集 actions =====

const PublishVocabSchema = z.object({
  setId: z.number(),
  category: z.string().min(1),
  gradeLevel: z.string().min(1),
});

export async function publishVocabToMarketplace(data: z.infer<typeof PublishVocabSchema>) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('未登入');
  }

  const parsed = PublishVocabSchema.safeParse(data);
  if (!parsed.success) {
    return { error: '請填寫完整資訊' };
  }

  // 驗 set 擁有者 + status='published'
  const [set] = await db
    .select({
      id: vocabSetSchema.id,
      status: vocabSetSchema.status,
    })
    .from(vocabSetSchema)
    .where(and(eq(vocabSetSchema.id, parsed.data.setId), eq(vocabSetSchema.ownerId, userId)))
    .limit(1);

  if (!set) {
    return { error: '找不到單字卡集或無權限' };
  }
  if (set.status !== 'published') {
    return { error: '請先發佈單字卡集再分享到市集' };
  }

  // 至少 1 張卡片
  const [cCount] = await db
    .select({ total: count() })
    .from(vocabCardSchema)
    .where(eq(vocabCardSchema.setId, parsed.data.setId));

  if (!cCount?.total) {
    return { error: '單字卡集沒有卡片，無法分享' };
  }

  await db
    .update(vocabSetSchema)
    .set({
      visibility: 'public',
      category: parsed.data.category,
      gradeLevel: parsed.data.gradeLevel,
    })
    .where(eq(vocabSetSchema.id, parsed.data.setId));

  revalidatePath('/marketplace');
  revalidatePath('/dashboard/vocab');
  return { success: true };
}

export async function unpublishVocabFromMarketplace(setId: number) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('未登入');
  }

  await db
    .update(vocabSetSchema)
    .set({ visibility: 'private' })
    .where(and(eq(vocabSetSchema.id, setId), eq(vocabSetSchema.ownerId, userId)));

  revalidatePath('/marketplace');
  revalidatePath('/dashboard/vocab');
}

export async function copyVocabFromMarketplace(sourceSetId: number) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('請先登入再複製');
  }

  const [source] = await db
    .select({
      id: vocabSetSchema.id,
      title: vocabSetSchema.title,
      category: vocabSetSchema.category,
      gradeLevel: vocabSetSchema.gradeLevel,
    })
    .from(vocabSetSchema)
    .where(and(eq(vocabSetSchema.id, sourceSetId), eq(vocabSetSchema.visibility, 'public')))
    .limit(1);

  if (!source) {
    return { error: '找不到此市集單字卡集' };
  }

  const cards = await db
    .select()
    .from(vocabCardSchema)
    .where(eq(vocabCardSchema.setId, sourceSetId))
    .orderBy(vocabCardSchema.position);

  // 新 set:複製到當前 user,visibility 預設 private(複製過來的不直接公開),category/grade 帶過來方便老師之後再上架
  const [newSet] = await db
    .insert(vocabSetSchema)
    .values({
      ownerId: userId,
      title: `${source.title}（複製）`,
      accessCode: nanoid(8),
      status: 'published',
      visibility: 'private',
      category: source.category,
      gradeLevel: source.gradeLevel,
    })
    .returning();

  if (!newSet) {
    return { error: '複製失敗' };
  }

  if (cards.length > 0) {
    await db.insert(vocabCardSchema).values(
      cards.map((c, i) => ({
        setId: newSet.id,
        front: c.front,
        back: c.back,
        phonetic: c.phonetic,
        example: c.example,
        position: i,
      })),
    );
  }

  // source forkCount += 1（原子 SQL increment）
  await db
    .update(vocabSetSchema)
    .set({ forkCount: sql`${vocabSetSchema.forkCount} + 1` })
    .where(eq(vocabSetSchema.id, sourceSetId));

  revalidatePath('/marketplace');
  revalidatePath('/dashboard/vocab');
  return { success: true, newSetId: newSet.id };
}
