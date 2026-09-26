'use server';

import { auth } from '@clerk/nextjs/server';
import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { reviewGameSchema, reviewSampleSchema, reviewSetSchema } from '@/models/Schema';

const RubricRefSchema = z.object({
  correctness: z.number().int().min(0).max(5),
  completeness: z.number().int().min(0).max(5),
  clarity: z.number().int().min(0).max(5),
  creativity: z.number().int().min(0).max(5),
});

const SampleInputSchema = z.object({
  content: z.string().trim().min(1, '範例答案內容不可為空').max(3000, '範例答案最多 3000 字'),
  ref: RubricRefSchema,
});

const ReviewSetInputSchema = z.object({
  title: z.string().trim().min(1, '請輸入標題').max(100, '標題最多 100 字'),
  topicPrompt: z.string().trim().min(1, '請輸入延伸創作指示').max(1000, '指示最多 1000 字'),
  teamSize: z.number().int().min(2).max(8),
  reviewDurationSec: z.number().int().min(60).max(3600),
  createDurationSec: z.number().int().min(60).max(3600),
  samples: z.array(SampleInputSchema).min(1, '至少要有 1 則範例答案').max(10, '最多 10 則範例答案'),
});
export type ReviewSetInput = z.infer<typeof ReviewSetInputSchema>;

async function verifyOwnership(reviewSetId: number, userId: string) {
  const [row] = await db
    .select({ id: reviewSetSchema.id })
    .from(reviewSetSchema)
    .where(and(eq(reviewSetSchema.id, reviewSetId), eq(reviewSetSchema.ownerId, userId)))
    .limit(1);
  if (!row) {
    throw new Error('找不到題組或沒有權限');
  }
}

export async function createReviewSet(input: ReviewSetInput) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }

  const parsed = ReviewSetInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? '資料格式錯誤' };
  }
  const data = parsed.data;

  const reviewSetId = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(reviewSetSchema)
      .values({
        ownerId: userId,
        title: data.title,
        topicPrompt: data.topicPrompt,
        teamSize: data.teamSize,
        reviewDurationSec: data.reviewDurationSec,
        createDurationSec: data.createDurationSec,
      })
      .returning();
    if (!inserted) {
      throw new Error('建立題組失敗');
    }
    await tx.insert(reviewSampleSchema).values(
      data.samples.map((s, i) => ({
        reviewSetId: inserted.id,
        content: s.content,
        orderIndex: i,
        refCorrectness: s.ref.correctness,
        refCompleteness: s.ref.completeness,
        refClarity: s.ref.clarity,
        refCreativity: s.ref.creativity,
      })),
    );
    return inserted.id;
  });

  revalidatePath('/dashboard/review');
  return { ok: true as const, reviewSetId };
}

export async function updateReviewSet(reviewSetId: number, input: ReviewSetInput) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }
  await verifyOwnership(reviewSetId, userId);

  const parsed = ReviewSetInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? '資料格式錯誤' };
  }
  const data = parsed.data;

  // 編輯範例答案前先確認沒有進行中的直播場次：review_score.sample_id 設了
  // onDelete: 'cascade'，下面砍掉重建 review_sample 會連帶砍光學生已送出的評分
  const activeGames = await db
    .select({ id: reviewGameSchema.id })
    .from(reviewGameSchema)
    .where(and(
      eq(reviewGameSchema.reviewSetId, reviewSetId),
      inArray(reviewGameSchema.status, ['team_forming', 'reviewing', 'creating', 'voting', 'results']),
    ))
    .limit(1);
  if (activeGames.length > 0) {
    return { error: '這個題組目前有進行中的直播場次，暫時無法編輯範例答案（避免影響學生已送出的評分）' };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(reviewSetSchema)
      .set({
        title: data.title,
        topicPrompt: data.topicPrompt,
        teamSize: data.teamSize,
        reviewDurationSec: data.reviewDurationSec,
        createDurationSec: data.createDurationSec,
      })
      .where(eq(reviewSetSchema.id, reviewSetId));

    // 範例答案採「整批砍掉重建」而非逐筆 diff：欄位少、老師編輯頻率低，
    // 換取實作簡單遠比省幾條 SQL 划算
    await tx.delete(reviewSampleSchema).where(eq(reviewSampleSchema.reviewSetId, reviewSetId));
    await tx.insert(reviewSampleSchema).values(
      data.samples.map((s, i) => ({
        reviewSetId,
        content: s.content,
        orderIndex: i,
        refCorrectness: s.ref.correctness,
        refCompleteness: s.ref.completeness,
        refClarity: s.ref.clarity,
        refCreativity: s.ref.creativity,
      })),
    );
  });

  revalidatePath('/dashboard/review');
  revalidatePath(`/dashboard/review/${reviewSetId}/edit`);
  return { ok: true as const };
}

export async function deleteReviewSet(reviewSetId: number) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }
  await verifyOwnership(reviewSetId, userId);

  // review_sample / review_game 系列表都設了 onDelete: 'cascade'，刪這筆就夠了
  await db.delete(reviewSetSchema).where(eq(reviewSetSchema.id, reviewSetId));

  revalidatePath('/dashboard/review');
  return { ok: true as const };
}
