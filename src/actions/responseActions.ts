'use server';

import { and, count, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { answerSchema, questionSchema, quizSchema, responseSchema } from '@/models/Schema';

const SubmitSchema = z.object({
  quizId: z.number().int().positive(),
  studentName: z.string().max(100).optional(),
  studentEmail: z.string().email().max(200).optional(),
  // { questionId: answer } — answer 是 string（簡答/是非）或 string[]（選擇題/排序題）
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  // 考試防作弊：學生離開頁面次數（preventLeave 開啟時才有意義）
  leaveCount: z.number().int().min(0).optional(),
  // 監考牆 attempt flow：若 client 在開始作答時已建 response row + 拿到 token，
  // 送此 token → server 改 UPDATE 既有 row（而非 INSERT 新 row）
  studentToken: z.string().min(1).optional(),
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

  const { quizId, studentName, studentEmail, answers, leaveCount, studentToken } = parsed.data;

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

    if (!isShortAnswer) {
      totalPoints += question.points;
    }
    if (isCorrect === true) {
      score += question.points;
    }

    details.push({ questionId: question.id, isCorrect, points: question.points });
  }

  // 寫入 response：
  //   - 有 studentToken（監考牆 attempt flow）→ UPDATE 既有 row，status 設 submitted
  //   - 無 studentToken（舊匿名 flow）→ INSERT 新 row
  let responseId: number;

  if (studentToken) {
    const [updated] = await db
      .update(responseSchema)
      .set({
        studentName: studentName || null,
        studentEmail: studentEmail || null,
        score,
        totalPoints,
        leaveCount: leaveCount ?? 0,
        status: 'submitted',
        submittedAt: new Date(),
      })
      .where(and(
        eq(responseSchema.quizId, quizId),
        eq(responseSchema.studentToken, studentToken),
      ))
      .returning();
    if (!updated) {
      throw new Error('找不到對應的作答紀錄，請重新整理頁面');
    }
    responseId = updated.id;
    // 砍掉前次誤提交的 answer（如果此 token 曾部分提交過，避免重複）
    await db.delete(answerSchema).where(eq(answerSchema.responseId, responseId));
  } else {
    const [inserted] = await db
      .insert(responseSchema)
      .values({
        quizId,
        studentName: studentName || null,
        studentEmail: studentEmail || null,
        score,
        totalPoints,
        leaveCount: leaveCount ?? 0,
      })
      .returning();
    if (!inserted) {
      throw new Error('儲存失敗');
    }
    responseId = inserted.id;
  }

  // 寫入每題的 answer
  const answerRows = questions
    .filter(q => answers[q.id.toString()] !== undefined)
    .map((q) => {
      const detail = details.find(d => d.questionId === q.id)!;
      return {
        responseId,
        questionId: q.id,
        answer: answers[q.id.toString()] as string | string[],
        isCorrect: detail.isCorrect,
      };
    });

  if (answerRows.length > 0) {
    await db.insert(answerSchema).values(answerRows);
  }

  return { responseId, score, totalPoints, details };
}
