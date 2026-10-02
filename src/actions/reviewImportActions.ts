'use server';

// 協作批閱「小組出一道題目」→ 老師一鍵把該組題目匯入正式題庫
import { auth } from '@clerk/nextjs/server';
import { and, count, eq, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { generateRoomCode } from '@/libs/fork';
import { getUserPlanId, isProOrAbove } from '@/libs/Plan';
import {
  questionSchema,
  quizSchema,
  reviewGameSchema,
  reviewSetSchema,
  reviewSubmissionSchema,
  reviewTeamSchema,
} from '@/models/Schema';
import { buildQuestionInsertFromCreated, parseCreatedQuestion } from '@/services/review/createModes';
import { PricingPlanList } from '@/utils/AppConfig';

const ImportInputSchema = z.object({
  gameId: z.number().int().positive(),
  teamId: z.number().int().positive(),
  quizId: z.number().int().positive().optional(),
});

export type ImportReviewSubmissionInput = z.infer<typeof ImportInputSchema>;
export type ImportReviewSubmissionResult = { ok: true; quizId: number } | { ok: false; error: string };

// 房間碼唯一性檢查，比照 quizActions / lessonPackageActions 的 generateUniqueRoomCode
async function generateUniqueRoomCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    const [existing] = await db
      .select({ id: quizSchema.id })
      .from(quizSchema)
      .where(eq(quizSchema.roomCode, code))
      .limit(1);
    if (!existing) {
      return code;
    }
  }
  return generateRoomCode() + generateRoomCode().slice(0, 1);
}

// 免費方案測驗數量上限，規則同 quizActions.createQuiz（VIP / Pro / 試用中不限）
async function isQuizQuotaExceeded(userId: string): Promise<boolean> {
  const { isVipUser } = await import('@/libs/vip');
  if (await isVipUser() || await isProOrAbove(userId)) {
    return false;
  }
  const planId = await getUserPlanId(userId);
  const quizLimit = PricingPlanList[planId]?.features.website ?? 10;
  if (quizLimit >= 999) {
    return false;
  }
  const [row] = await db
    .select({ total: count() })
    .from(quizSchema)
    .where(and(eq(quizSchema.ownerId, userId), ne(quizSchema.quizMode, 'live_snapshot')));
  return (row?.total ?? 0) >= quizLimit;
}

export async function importReviewSubmissionToQuiz(
  input: ImportReviewSubmissionInput,
): Promise<ImportReviewSubmissionResult> {
  const { userId } = await auth();
  if (!userId) {
    return { ok: false, error: '請先登入' };
  }

  const parsed = ImportInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: '資料格式錯誤' };
  }
  const { gameId, teamId, quizId } = parsed.data;

  // 比照 reviewActions.loadOwnedReviewGame：只有開這場的老師能匯入
  const [game] = await db
    .select({ id: reviewGameSchema.id, reviewSetId: reviewGameSchema.reviewSetId })
    .from(reviewGameSchema)
    .where(and(eq(reviewGameSchema.id, gameId), eq(reviewGameSchema.hostUserId, userId)))
    .limit(1);
  if (!game) {
    return { ok: false, error: '找不到場次或沒有權限' };
  }

  const [reviewSet] = await db
    .select({ title: reviewSetSchema.title, createMode: reviewSetSchema.createMode })
    .from(reviewSetSchema)
    .where(eq(reviewSetSchema.id, game.reviewSetId))
    .limit(1);
  if (!reviewSet || reviewSet.createMode !== 'question') {
    return { ok: false, error: '這個場次不是「小組出題」型態' };
  }

  const [team] = await db
    .select({ id: reviewTeamSchema.id })
    .from(reviewTeamSchema)
    .where(and(eq(reviewTeamSchema.id, teamId), eq(reviewTeamSchema.gameId, gameId)))
    .limit(1);
  if (!team) {
    return { ok: false, error: '找不到這個小組' };
  }

  const [submission] = await db
    .select({ content: reviewSubmissionSchema.content })
    .from(reviewSubmissionSchema)
    .where(eq(reviewSubmissionSchema.teamId, teamId))
    .limit(1);
  const question = submission ? parseCreatedQuestion(submission.content) : null;
  if (!question) {
    return { ok: false, error: '這組的題目未完成，無法匯入' };
  }

  if (quizId !== undefined) {
    const [quiz] = await db
      .select({ id: quizSchema.id })
      .from(quizSchema)
      .where(and(eq(quizSchema.id, quizId), eq(quizSchema.ownerId, userId)))
      .limit(1);
    if (!quiz) {
      return { ok: false, error: '找不到此測驗' };
    }
    // position 規則同 questionActions.createQuestion：接在目前最大 position 後面
    const existing = await db
      .select({ position: questionSchema.position })
      .from(questionSchema)
      .where(eq(questionSchema.quizId, quizId));
    const nextPosition = existing.length > 0 ? Math.max(...existing.map(q => q.position)) + 1 : 1;
    await db.insert(questionSchema).values(buildQuestionInsertFromCreated(question, quizId, nextPosition));
    revalidatePath(`/dashboard/quizzes/${quizId}/edit`);
    return { ok: true, quizId };
  }

  if (await isQuizQuotaExceeded(userId)) {
    return { ok: false, error: '已達免費方案的測驗數量上限，請升級方案或改加入既有測驗' };
  }

  const roomCode = await generateUniqueRoomCode();
  const newQuizId = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(quizSchema)
      .values({
        ownerId: userId,
        title: `協作批閱：${reviewSet.title}`.slice(0, 200),
        accessCode: nanoid(8),
        roomCode,
        quizMode: 'standard',
      })
      .returning();
    if (!inserted) {
      throw new Error('建立測驗失敗');
    }
    await tx.insert(questionSchema).values(buildQuestionInsertFromCreated(question, inserted.id, 1));
    return inserted.id;
  });

  revalidatePath('/dashboard/quizzes');
  return { ok: true, quizId: newQuizId };
}
