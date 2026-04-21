'use server';

// AI 申論題/作文批改的 Server Actions
// 直接呼叫 Claude（避免 RSC → Route 內部往返），寫入 answer.aiGrading / points / gradedAt
// 並觸發 recomputeResponseScore 同步更新 response.score

import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { anthropic, CLAUDE_MODEL } from '@/lib/ai/client';
import {
  buildEssayGradingUserPrompt,
  DEFAULT_ESSAY_RUBRIC,
  ESSAY_GRADING_SYSTEM_PROMPT,
  type EssayGradingResult,
  EssayGradingResultSchema,
  type EssayRubric,
} from '@/lib/ai/prompts';
import { db } from '@/libs/DB';
import { isProOrAbove } from '@/libs/Plan';
import {
  answerSchema,
  questionSchema,
  quizSchema,
  responseSchema,
} from '@/models/Schema';

import { checkAndIncrementAiUsage } from './aiUsageActions';
import { recomputeResponseScore } from './responseActions';

export type EssayGradeOutcome =
  | { status: 'ok'; answerId: number; awardedPoints: number; grading: EssayGradingResult }
  | { status: 'skipped'; answerId: number; reason: string }
  | { status: 'quota_exceeded'; answerId: number; reason: string }
  | { status: 'pro_required' }
  | { status: 'failed'; answerId: number; error: string };

/**
 * 批改單一 answer（僅 short_answer 會實際呼叫 AI）
 * 已批改（gradedAt != null）的 answer 直接回 skipped，不再扣配額
 */
export async function gradeEssayAnswerAction(
  answerId: number,
): Promise<EssayGradeOutcome> {
  const { orgId } = await auth();
  if (!orgId) {
    return { status: 'pro_required' };
  }

  if (!(await isProOrAbove(orgId))) {
    return { status: 'pro_required' };
  }

  const rows = await db
    .select({
      answerId: answerSchema.id,
      responseId: answerSchema.responseId,
      studentAnswer: answerSchema.answer,
      alreadyGradedAt: answerSchema.gradedAt,
      questionBody: questionSchema.body,
      questionType: questionSchema.type,
      rubric: questionSchema.rubric,
      questionPoints: questionSchema.points,
      quizId: quizSchema.id,
      quizOwnerId: quizSchema.ownerId,
    })
    .from(answerSchema)
    .innerJoin(questionSchema, eq(answerSchema.questionId, questionSchema.id))
    .innerJoin(responseSchema, eq(answerSchema.responseId, responseSchema.id))
    .innerJoin(quizSchema, eq(responseSchema.quizId, quizSchema.id))
    .where(and(eq(answerSchema.id, answerId), eq(quizSchema.ownerId, orgId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return { status: 'failed', answerId, error: '找不到作答記錄' };
  }

  if (row.questionType !== 'short_answer') {
    return { status: 'skipped', answerId, reason: '非簡答題，略過' };
  }

  if (row.alreadyGradedAt) {
    return { status: 'skipped', answerId, reason: '已批改過，略過' };
  }

  const studentText
    = typeof row.studentAnswer === 'string'
      ? row.studentAnswer
      : Array.isArray(row.studentAnswer)
        ? row.studentAnswer.join(' ')
        : '';

  if (!studentText.trim()) {
    return { status: 'skipped', answerId, reason: '學生答案為空，略過' };
  }

  // 檢查並遞增 essay_grading quota
  const quota = await checkAndIncrementAiUsage(orgId, 'essay_grading');
  if (!quota.allowed) {
    return { status: 'quota_exceeded', answerId, reason: quota.reason };
  }

  const rubric: EssayRubric = row.rubric ?? DEFAULT_ESSAY_RUBRIC;

  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      system: ESSAY_GRADING_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildEssayGradingUserPrompt({
            question: row.questionBody,
            rubric,
            studentAnswer: studentText,
          }),
        },
      ],
    });

    const firstBlock = message.content[0];
    const raw
      = firstBlock && 'text' in firstBlock
        ? (firstBlock as { text: string }).text
        : '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return { status: 'failed', answerId, error: 'AI 回傳格式錯誤' };
    }

    const parsed = EssayGradingResultSchema.safeParse(JSON.parse(match[0]));
    if (!parsed.success) {
      return { status: 'failed', answerId, error: 'AI 回傳結構不符' };
    }

    // 按比例換算到本題配分
    const awardedPoints = parsed.data.maxScore > 0
      ? Math.round((parsed.data.totalScore / parsed.data.maxScore) * row.questionPoints)
      : 0;

    await db
      .update(answerSchema)
      .set({
        aiGrading: parsed.data,
        points: awardedPoints,
        gradedAt: new Date(),
        gradedBy: 'ai',
      })
      .where(eq(answerSchema.id, answerId));

    await recomputeResponseScore(row.responseId);

    revalidatePath(`/dashboard/quizzes/${row.quizId}/results`);

    return {
      status: 'ok',
      answerId,
      awardedPoints,
      grading: parsed.data,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知錯誤';
    return { status: 'failed', answerId, error: msg };
  }
}

/**
 * 老師手動覆核：調整分數與評語（不耗 AI 配額）
 */
export async function updateEssayGradingAction(
  answerId: number,
  data: { points?: number | null; teacherFeedback?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { orgId } = await auth();
  if (!orgId) {
    return { ok: false, error: '未登入' };
  }

  // 驗證擁有權
  const rows = await db
    .select({
      answerId: answerSchema.id,
      responseId: answerSchema.responseId,
      quizId: quizSchema.id,
      wasGraded: answerSchema.gradedAt,
    })
    .from(answerSchema)
    .innerJoin(responseSchema, eq(answerSchema.responseId, responseSchema.id))
    .innerJoin(quizSchema, eq(responseSchema.quizId, quizSchema.id))
    .where(and(eq(answerSchema.id, answerId), eq(quizSchema.ownerId, orgId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return { ok: false, error: '找不到作答記錄' };
  }

  await db
    .update(answerSchema)
    .set({
      ...(data.points !== undefined ? { points: data.points } : {}),
      ...(data.teacherFeedback !== undefined ? { teacherFeedback: data.teacherFeedback } : {}),
      gradedAt: new Date(),
      gradedBy: row.wasGraded ? 'ai+teacher' : 'teacher',
    })
    .where(eq(answerSchema.id, answerId));

  await recomputeResponseScore(row.responseId);
  revalidatePath(`/dashboard/quizzes/${row.quizId}/results`);

  return { ok: true };
}
