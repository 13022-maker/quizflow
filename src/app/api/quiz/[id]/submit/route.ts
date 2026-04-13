/**
 * 多次作答計分 API
 * POST /api/quiz/[id]/submit
 *
 * 與現有的 submitQuizResponse Server Action 互補：
 * - submitQuizResponse：處理單次作答的批改與寫入 response/answer
 * - 本 route：接收批改結果，計算多次作答的加權分數與最終成績
 *
 * 學生端在 submitQuizResponse 完成後，若 quiz.scoringMode !== 'highest' 或有多次作答，
 * 額外呼叫此 API 更新 quiz_attempt + quiz_final_score。
 */

import { and, count, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import type { Attempt, QuizScoringConfig } from '@/libs/scoring';
import {
  calcFinalScore,
  calcWeightedScore,
  canAttempt,
} from '@/libs/scoring';
import { quizAttemptSchema, quizFinalScoreSchema, quizSchema } from '@/models/Schema';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const quizId = Number(params.id);
  if (Number.isNaN(quizId)) {
    return NextResponse.json({ error: '無效的測驗 ID' }, { status: 400 });
  }

  const { rawScore, timeSpentSecs, studentEmail, responseId } = await req.json();

  if (!studentEmail || typeof rawScore !== 'number') {
    return NextResponse.json({ error: '缺少 studentEmail 或 rawScore' }, { status: 400 });
  }

  // 1. 取得 quiz 設定
  const [quiz] = await db
    .select({
      scoringMode: quizSchema.scoringMode,
      allowedAttempts: quizSchema.allowedAttempts,
      attemptDecayRate: quizSchema.attemptDecayRate,
    })
    .from(quizSchema)
    .where(eq(quizSchema.id, quizId))
    .limit(1);

  if (!quiz) {
    return NextResponse.json({ error: '找不到測驗' }, { status: 404 });
  }

  const config: QuizScoringConfig = {
    mode: (quiz.scoringMode as QuizScoringConfig['mode']) ?? 'highest',
    maxAttempts: quiz.allowedAttempts ?? null,
    decayRate: quiz.attemptDecayRate ?? 0.9,
  };

  // 2. 取得目前作答次數
  const [countRow] = await db
    .select({ value: count() })
    .from(quizAttemptSchema)
    .where(
      and(
        eq(quizAttemptSchema.quizId, quizId),
        eq(quizAttemptSchema.studentEmail, studentEmail),
      ),
    );

  const currentCount = countRow?.value ?? 0;

  if (!canAttempt(currentCount, config)) {
    return NextResponse.json({ error: '已達作答上限' }, { status: 403 });
  }

  const attemptNumber = currentCount + 1;
  const weightedScore = calcWeightedScore(rawScore, attemptNumber, config);

  // 3. 寫入本次作答記錄
  const [newAttempt] = await db
    .insert(quizAttemptSchema)
    .values({
      quizId,
      studentEmail,
      attemptNumber,
      rawScore,
      weightedScore,
      timeSpentSecs: timeSpentSecs ?? null,
      responseId: responseId ?? null,
    })
    .returning();

  // 4. 取得所有作答記錄，重算最終成績
  const allAttempts = await db
    .select({
      id: quizAttemptSchema.id,
      attemptNumber: quizAttemptSchema.attemptNumber,
      rawScore: quizAttemptSchema.rawScore,
      submittedAt: quizAttemptSchema.submittedAt,
    })
    .from(quizAttemptSchema)
    .where(
      and(
        eq(quizAttemptSchema.quizId, quizId),
        eq(quizAttemptSchema.studentEmail, studentEmail),
      ),
    )
    .orderBy(quizAttemptSchema.attemptNumber);

  const attempts: Attempt[] = allAttempts.map(a => ({
    attemptNumber: a.attemptNumber,
    rawScore: a.rawScore,
    submittedAt: a.submittedAt,
  }));

  const result = calcFinalScore(attempts, config);

  // 找出計入的那次作答的 id
  const winningAttempt = allAttempts.find(
    a => a.attemptNumber === result.winningAttemptNumber,
  );

  // 5. Upsert quiz_final_score
  const [existing] = await db
    .select({ id: quizFinalScoreSchema.id })
    .from(quizFinalScoreSchema)
    .where(
      and(
        eq(quizFinalScoreSchema.quizId, quizId),
        eq(quizFinalScoreSchema.studentEmail, studentEmail),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(quizFinalScoreSchema)
      .set({
        finalScore: result.finalScore,
        totalAttempts: result.totalAttempts,
        winningAttemptId: winningAttempt?.id ?? null,
      })
      .where(eq(quizFinalScoreSchema.id, existing.id));
  } else {
    await db.insert(quizFinalScoreSchema).values({
      quizId,
      studentEmail,
      finalScore: result.finalScore,
      totalAttempts: result.totalAttempts,
      winningAttemptId: winningAttempt?.id ?? null,
    });
  }

  return NextResponse.json({
    attempt: newAttempt,
    finalScore: result.finalScore,
    isExhausted: result.isExhausted,
    totalAttempts: result.totalAttempts,
  });
}
