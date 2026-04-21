'use server';

import { auth } from '@clerk/nextjs/server';
import { and, asc, count, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import type { EssayGradingResult } from '@/lib/ai/prompts';
import { answerSchema, questionSchema, quizSchema, responseSchema } from '@/models/Schema';

const SubmitSchema = z.object({
  quizId: z.number().int().positive(),
  studentName: z.string().max(100).optional(),
  studentEmail: z.string().email().max(200).optional(),
  // { questionId: answer } — answer 是 string（簡答/是非）或 string[]（選擇題/排序題）
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  // 考試防作弊：學生離開頁面次數（preventLeave 開啟時才有意義）
  leaveCount: z.number().int().min(0).optional(),
});

export type SubmitInput = z.infer<typeof SubmitSchema>;

export type SubmitResult = {
  responseId: number;
  score: number;
  totalPoints: number;
  details: {
    questionId: number;
    isCorrect: boolean | null; // null = 簡答題
    points: number;
  }[];
};

/** 查詢某個 email 在指定測驗的已作答次數 */
export async function checkAttemptCount(quizId: number, email: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(responseSchema)
    .where(and(eq(responseSchema.quizId, quizId), eq(responseSchema.studentEmail, email)));
  return row?.value ?? 0;
}

export async function submitQuizResponse(data: SubmitInput): Promise<SubmitResult> {
  const parsed = SubmitSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('格式錯誤');
  }

  const { quizId, studentName, studentEmail, answers, leaveCount } = parsed.data;

  // 取得測驗設定（用於 server-side 驗證作答次數）
  const [quiz] = await db
    .select({ allowedAttempts: quizSchema.allowedAttempts })
    .from(quizSchema)
    .where(eq(quizSchema.id, quizId))
    .limit(1);

  // Server-side 驗證：有 email 且測驗限制作答次數時才檢查
  if (quiz?.allowedAttempts && studentEmail) {
    const attemptCount = await checkAttemptCount(quizId, studentEmail);
    if (attemptCount >= quiz.allowedAttempts) {
      throw new Error('ATTEMPT_LIMIT_EXCEEDED');
    }
  }

  // 取得所有題目的正確答案與配分
  const questions = await db
    .select()
    .from(questionSchema)
    .where(eq(questionSchema.quizId, quizId));

  if (questions.length === 0) {
    throw new Error('找不到題目');
  }

  // 批改
  let score = 0;
  let totalPoints = 0;
  let hasUngradedShortAnswer = false;
  const details: SubmitResult['details'] = [];

  for (const question of questions) {
    const studentAnswer = answers[question.id.toString()];
    const isShortAnswer = question.type === 'short_answer';

    let isCorrect: boolean | null = null;

    if (!isShortAnswer && question.correctAnswers && studentAnswer !== undefined) {
      const correct = question.correctAnswers;
      if (question.type === 'single_choice' || question.type === 'true_false' || question.type === 'listening') {
        isCorrect = correct.includes(studentAnswer as string);
      } else if (question.type === 'multiple_choice') {
        const given = Array.isArray(studentAnswer) ? [...studentAnswer].sort() : [];
        const expected = [...correct].sort();
        isCorrect = JSON.stringify(given) === JSON.stringify(expected);
      } else if (question.type === 'ranking') {
        // 排序題：學生答案順序必須與正確順序完全一致才算對
        const given = Array.isArray(studentAnswer) ? studentAnswer : [];
        isCorrect = JSON.stringify(given) === JSON.stringify(correct);
      }
    }

    // 所有題型的滿分都納入 totalPoints（含簡答題，讓批改前的分母正確）
    totalPoints += question.points;

    if (isCorrect === true) {
      score += question.points;
    }

    if (isShortAnswer && studentAnswer !== undefined && String(studentAnswer).trim() !== '') {
      hasUngradedShortAnswer = true;
    }

    details.push({ questionId: question.id, isCorrect, points: question.points });
  }

  // 若含待批改的簡答題，score 先記為 null（等 AI / 老師批改後由 recomputeResponseScore 回填）
  const finalScore = hasUngradedShortAnswer ? null : score;

  // 寫入 response
  const [inserted] = await db
    .insert(responseSchema)
    .values({
      quizId,
      studentName: studentName || null,
      studentEmail: studentEmail || null,
      score: finalScore,
      totalPoints,
      leaveCount: leaveCount ?? 0,
    })
    .returning();

  if (!inserted) {
    throw new Error('儲存失敗');
  }

  // 寫入每題的 answer
  const answerRows = questions
    .filter(q => answers[q.id.toString()] !== undefined)
    .map((q) => {
      const detail = details.find(d => d.questionId === q.id)!;
      return {
        responseId: inserted.id,
        questionId: q.id,
        answer: answers[q.id.toString()] as string | string[],
        isCorrect: detail.isCorrect,
      };
    });

  if (answerRows.length > 0) {
    await db.insert(answerSchema).values(answerRows);
  }

  return { responseId: inserted.id, score: finalScore ?? 0, totalPoints, details };
}

/**
 * 重新計算單一 response 的 score
 * - 非簡答題：依 isCorrect × question.points
 * - 簡答題：依 answer.points（AI/老師批改後寫入）
 * - 若仍有尚未批改（gradedAt=null 且有作答）的簡答題，score 保持 null
 */
export async function recomputeResponseScore(responseId: number): Promise<void> {
  const rows = await db
    .select({
      questionId: answerSchema.questionId,
      questionType: questionSchema.type,
      questionPoints: questionSchema.points,
      answerText: answerSchema.answer,
      isCorrect: answerSchema.isCorrect,
      answerPoints: answerSchema.points,
      gradedAt: answerSchema.gradedAt,
    })
    .from(answerSchema)
    .innerJoin(questionSchema, eq(answerSchema.questionId, questionSchema.id))
    .where(eq(answerSchema.responseId, responseId));

  let score = 0;
  let hasUngraded = false;

  for (const row of rows) {
    if (row.questionType === 'short_answer') {
      const studentText
        = typeof row.answerText === 'string'
          ? row.answerText
          : Array.isArray(row.answerText)
            ? row.answerText.join(' ')
            : '';
      if (!row.gradedAt && studentText.trim() !== '') {
        hasUngraded = true;
        continue;
      }
      score += row.answerPoints ?? 0;
    } else if (row.isCorrect === true) {
      score += row.questionPoints;
    }
  }

  await db
    .update(responseSchema)
    .set({ score: hasUngraded ? null : score })
    .where(eq(responseSchema.id, responseId));
}

export type ResponseDetail = {
  response: {
    id: number;
    quizId: number;
    studentName: string | null;
    studentEmail: string | null;
    score: number | null;
    totalPoints: number | null;
    submittedAt: string;
  };
  items: Array<{
    answerId: number;
    questionId: number;
    position: number;
    questionBody: string;
    questionType: string;
    questionPoints: number;
    options: { id: string; text: string }[] | null;
    correctAnswers: string[] | null;
    studentAnswer: string | string[];
    isCorrect: boolean | null;
    // 申論題批改狀態
    awardedPoints: number | null;
    aiGrading: EssayGradingResult | null;
    teacherFeedback: string | null;
    gradedAt: string | null;
    gradedBy: string | null;
  }>;
};

/**
 * 取得單一 response 的完整作答內容（老師成績詳細檢視用）
 * 驗證 quiz.ownerId === orgId 做多租戶隔離
 */
export async function getResponseDetail(
  responseId: number,
): Promise<ResponseDetail | null> {
  const { orgId } = await auth();
  if (!orgId) {
    return null;
  }

  const [responseRow] = await db
    .select({
      id: responseSchema.id,
      quizId: responseSchema.quizId,
      studentName: responseSchema.studentName,
      studentEmail: responseSchema.studentEmail,
      score: responseSchema.score,
      totalPoints: responseSchema.totalPoints,
      submittedAt: responseSchema.submittedAt,
      ownerId: quizSchema.ownerId,
    })
    .from(responseSchema)
    .innerJoin(quizSchema, eq(responseSchema.quizId, quizSchema.id))
    .where(eq(responseSchema.id, responseId))
    .limit(1);

  if (!responseRow || responseRow.ownerId !== orgId) {
    return null;
  }

  const rows = await db
    .select({
      answerId: answerSchema.id,
      questionId: answerSchema.questionId,
      studentAnswer: answerSchema.answer,
      isCorrect: answerSchema.isCorrect,
      awardedPoints: answerSchema.points,
      aiGrading: answerSchema.aiGrading,
      teacherFeedback: answerSchema.teacherFeedback,
      gradedAt: answerSchema.gradedAt,
      gradedBy: answerSchema.gradedBy,
      questionBody: questionSchema.body,
      questionType: questionSchema.type,
      questionPoints: questionSchema.points,
      position: questionSchema.position,
      options: questionSchema.options,
      correctAnswers: questionSchema.correctAnswers,
    })
    .from(answerSchema)
    .innerJoin(questionSchema, eq(answerSchema.questionId, questionSchema.id))
    .where(eq(answerSchema.responseId, responseId))
    .orderBy(asc(questionSchema.position));

  return {
    response: {
      id: responseRow.id,
      quizId: responseRow.quizId,
      studentName: responseRow.studentName,
      studentEmail: responseRow.studentEmail,
      score: responseRow.score,
      totalPoints: responseRow.totalPoints,
      submittedAt: responseRow.submittedAt.toISOString(),
    },
    items: rows.map(r => ({
      answerId: r.answerId,
      questionId: r.questionId,
      position: r.position,
      questionBody: r.questionBody,
      questionType: r.questionType,
      questionPoints: r.questionPoints,
      options: r.options,
      correctAnswers: r.correctAnswers,
      studentAnswer: r.studentAnswer,
      isCorrect: r.isCorrect,
      awardedPoints: r.awardedPoints,
      aiGrading: r.aiGrading,
      teacherFeedback: r.teacherFeedback,
      gradedAt: r.gradedAt ? r.gradedAt.toISOString() : null,
      gradedBy: r.gradedBy,
    })),
  };
}

/**
 * 列出某 quiz 所有 response 的「待批改」狀態（用於列表頁 badge）
 * 多租戶：orgId 驗證透過呼叫端的 quiz 擁有權檢查
 */
export async function listResponseGradingStatus(
  quizId: number,
): Promise<Array<{ responseId: number; hasUngradedEssay: boolean; hasEssay: boolean }>> {
  const { orgId } = await auth();
  if (!orgId) {
    return [];
  }

  const [quiz] = await db
    .select({ ownerId: quizSchema.ownerId })
    .from(quizSchema)
    .where(eq(quizSchema.id, quizId))
    .limit(1);

  if (!quiz || quiz.ownerId !== orgId) {
    return [];
  }

  const rows = await db
    .select({
      responseId: answerSchema.responseId,
      questionType: questionSchema.type,
      studentAnswer: answerSchema.answer,
      gradedAt: answerSchema.gradedAt,
    })
    .from(answerSchema)
    .innerJoin(questionSchema, eq(answerSchema.questionId, questionSchema.id))
    .innerJoin(responseSchema, eq(answerSchema.responseId, responseSchema.id))
    .where(eq(responseSchema.quizId, quizId));

  const byResponse = new Map<number, { hasUngradedEssay: boolean; hasEssay: boolean }>();
  for (const r of rows) {
    if (r.questionType !== 'short_answer') {
      continue;
    }
    const current = byResponse.get(r.responseId) ?? { hasUngradedEssay: false, hasEssay: false };
    current.hasEssay = true;
    const text
      = typeof r.studentAnswer === 'string'
        ? r.studentAnswer
        : Array.isArray(r.studentAnswer)
          ? r.studentAnswer.join(' ')
          : '';
    if (!r.gradedAt && text.trim() !== '') {
      current.hasUngradedEssay = true;
    }
    byResponse.set(r.responseId, current);
  }

  return Array.from(byResponse.entries()).map(([responseId, v]) => ({
    responseId,
    ...v,
  }));
}
