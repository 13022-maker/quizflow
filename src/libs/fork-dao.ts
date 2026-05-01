// Fork API DAO 層:純資料庫存取,不含業務規則
// 業務規則（visibility / self-fork / plan）由 fork.ts 的 assertCanFork 處理

import { eq, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { questionSchema, quizSchema } from '@/models/Schema';

import {
  buildForkedQuestions,
  buildNewQuizValues,
  type SourceQuestion,
  type SourceQuiz,
} from './fork';

/**
 * 取得 source quiz 的所有可繼承欄位。
 * 不過濾 visibility（交給 assertCanFork 判斷,避免 404 / 403 邏輯散落兩處）。
 * 找不到時回 null。
 */
export async function loadSourceQuiz(sourceId: number): Promise<SourceQuiz | null> {
  const [row] = await db
    .select({
      id: quizSchema.id,
      ownerId: quizSchema.ownerId,
      title: quizSchema.title,
      description: quizSchema.description,
      visibility: quizSchema.visibility,
      shuffleQuestions: quizSchema.shuffleQuestions,
      shuffleOptions: quizSchema.shuffleOptions,
      allowedAttempts: quizSchema.allowedAttempts,
      showAnswers: quizSchema.showAnswers,
      timeLimitSeconds: quizSchema.timeLimitSeconds,
      preventLeave: quizSchema.preventLeave,
      scoringMode: quizSchema.scoringMode,
      attemptDecayRate: quizSchema.attemptDecayRate,
      quizMode: quizSchema.quizMode,
      category: quizSchema.category,
      gradeLevel: quizSchema.gradeLevel,
      tags: quizSchema.tags,
    })
    .from(quizSchema)
    .where(eq(quizSchema.id, sourceId))
    .limit(1);

  return row ?? null;
}

// 取 source 的所有題目（含 aiHint，按 position 排序）
async function loadSourceQuestions(sourceId: number): Promise<SourceQuestion[]> {
  return db
    .select({
      type: questionSchema.type,
      body: questionSchema.body,
      imageUrl: questionSchema.imageUrl,
      audioUrl: questionSchema.audioUrl,
      audioTranscript: questionSchema.audioTranscript,
      options: questionSchema.options,
      correctAnswers: questionSchema.correctAnswers,
      points: questionSchema.points,
      position: questionSchema.position,
      aiHint: questionSchema.aiHint,
    })
    .from(questionSchema)
    .where(eq(questionSchema.quizId, sourceId))
    .orderBy(questionSchema.position);
}

/**
 * 在 DB transaction 內：
 *   1. insert 新 quiz
 *   2. 拷貝所有 questions（含 aiHint,修既有 copyQuizFromMarketplace 漏拷）
 *   3. source.forkCount + 1（atomic SQL）
 *
 * 任一步失敗整段 rollback,不會留 orphan quiz（修既有實作的 bug）。
 */
export async function insertForkedQuiz(args: {
  source: SourceQuiz;
  ownerId: string;
  codes: { accessCode: string; roomCode: string };
}): Promise<{ newQuizId: number }> {
  const { source, ownerId, codes } = args;
  // 題目先抓出來（不在 transaction 內,讀取 idempotent 安全）
  const questions = await loadSourceQuestions(source.id);

  return db.transaction(async (tx) => {
    const [newQuiz] = await tx
      .insert(quizSchema)
      .values(buildNewQuizValues(source, ownerId, codes))
      .returning();

    if (!newQuiz) {
      throw new Error('insert forked quiz returned no row');
    }

    if (questions.length > 0) {
      await tx
        .insert(questionSchema)
        .values(buildForkedQuestions(questions, newQuiz.id));
    }

    await tx
      .update(quizSchema)
      .set({ forkCount: sql`${quizSchema.forkCount} + 1` })
      .where(eq(quizSchema.id, source.id));

    return { newQuizId: newQuiz.id };
  });
}
