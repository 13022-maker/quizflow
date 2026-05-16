'use server';

import { auth } from '@clerk/nextjs/server';
import { and, count, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { GradeResult } from '@/lib/ai/gradeShortAnswer';
import { gradeShortAnswer } from '@/lib/ai/gradeShortAnswer';
import { db } from '@/libs/DB';
import { isUserProOrAbove } from '@/libs/Plan';
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
    answerId?: number; // 已寫入 DB 的 answer.id（簡答題申訴需用）
    isCorrect: boolean | null; // null = 簡答題待批改（AI 批改失敗 / Free 帳號）
    points: number; // 該題滿分
    awardedPoints: number; // 該題實得分（簡答題可為部分分，其他題型為 0 或滿分）
    aiReason?: string; // 簡答題 AI 評語（只在有評時填）
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

  // 取得測驗設定（用於 server-side 驗證作答次數 + 拿 ownerId 判斷 AI 評分權限）
  const [quiz] = await db
    .select({
      allowedAttempts: quizSchema.allowedAttempts,
      ownerId: quizSchema.ownerId,
    })
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

  // 簡答題 AI 評分：擁有者 Pro 才啟用（學生作答端沒登入，用 quiz.ownerId 查方案）
  const ownerIsPro = quiz?.ownerId ? await isUserProOrAbove(quiz.ownerId) : false;

  // 並行對所有簡答題呼叫 AI 評分（5 題 × 5 秒 序列 = 25 秒；並行 = 5 秒）
  // gradingResults: questionId → GradeResult (成功) / null (Free 不批 或 AI 呼叫炸鍋待批改)
  const gradingResults = new Map<number, GradeResult | null>();
  if (ownerIsPro) {
    const shortAnswerQuestions = questions.filter(q => q.type === 'short_answer');
    const settled = await Promise.allSettled(
      shortAnswerQuestions.map(async (q) => {
        const studentAnswer = answers[q.id.toString()];
        const studentText = typeof studentAnswer === 'string' ? studentAnswer : '';
        const grade = await gradeShortAnswer({
          questionBody: q.body,
          referenceAnswer: q.referenceAnswer ?? null,
          studentAnswer: studentText,
          maxPoints: q.points,
        });
        return { id: q.id, grade };
      }),
    );
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        gradingResults.set(result.value.id, result.value.grade);
      }
      // rejected 的不放進 map，下方迴圈會 fallback 成「待批改」
    }
  }

  // 批改 + 計分
  let score = 0;
  let totalPoints = 0;
  const details: SubmitResult['details'] = [];
  // 記錄每題 gradingMeta（給後續寫入 answerSchema 用）
  const gradingMetaByQuestion = new Map<number, NonNullable<typeof answerSchema.$inferInsert.gradingMeta>>();

  for (const question of questions) {
    const studentAnswer = answers[question.id.toString()];
    const isShortAnswer = question.type === 'short_answer';

    let isCorrect: boolean | null = null;
    let awardedPoints = 0;
    let aiReason: string | undefined;

    if (isShortAnswer) {
      // Pro：simple answer 滿分加進 totalPoints
      // Free：保持現狀（不批不計分，連分母也不加）
      if (ownerIsPro) {
        totalPoints += question.points;
        const grade = gradingResults.get(question.id);
        if (grade) {
          isCorrect = grade.isCorrect;
          awardedPoints = grade.score;
          aiReason = grade.reason;
          gradingMetaByQuestion.set(question.id, {
            reason: grade.reason,
            confidence: grade.confidence,
            aiScore: grade.score,
            gradedBy: 'ai',
            gradedAt: new Date().toISOString(),
          });
        } else {
          // AI 批改失敗 → 標 isCorrect=null（待批改），不計分等老師複核
          isCorrect = null;
          aiReason = 'AI 批改失敗，待老師複核';
          gradingMetaByQuestion.set(question.id, {
            reason: aiReason,
            confidence: 0,
            aiScore: 0,
            gradedBy: 'ai',
            gradedAt: new Date().toISOString(),
          });
        }
      }
    } else if (question.correctAnswers && studentAnswer !== undefined) {
      // 既有題型批改邏輯
      const correct = question.correctAnswers;
      if (question.type === 'single_choice' || question.type === 'true_false' || question.type === 'listening') {
        isCorrect = correct.includes(studentAnswer as string);
      } else if (question.type === 'multiple_choice') {
        const given = Array.isArray(studentAnswer) ? [...studentAnswer].sort() : [];
        const expected = [...correct].sort();
        isCorrect = JSON.stringify(given) === JSON.stringify(expected);
      } else if (question.type === 'ranking') {
        const given = Array.isArray(studentAnswer) ? studentAnswer : [];
        isCorrect = JSON.stringify(given) === JSON.stringify(correct);
      }
      totalPoints += question.points;
      if (isCorrect === true) {
        awardedPoints = question.points;
      }
    } else if (!isShortAnswer) {
      // 沒設正解或學生沒作答的非簡答題：算進分母但 0 分
      totalPoints += question.points;
    }

    score += awardedPoints;
    details.push({
      questionId: question.id,
      isCorrect,
      points: question.points,
      awardedPoints,
      ...(aiReason ? { aiReason } : {}),
    });
  }

  // 寫入 response
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

  // 寫入每題的 answer（簡答題附 gradingMeta，其他題型 gradingMeta=null）
  const answerRows = questions
    .filter(q => answers[q.id.toString()] !== undefined)
    .map((q) => {
      const detail = details.find(d => d.questionId === q.id)!;
      return {
        responseId: inserted.id,
        questionId: q.id,
        answer: answers[q.id.toString()] as string | string[],
        isCorrect: detail.isCorrect,
        gradingMeta: gradingMetaByQuestion.get(q.id) ?? null,
      };
    });

  if (answerRows.length > 0) {
    const insertedAnswers = await db
      .insert(answerSchema)
      .values(answerRows)
      .returning({ id: answerSchema.id, questionId: answerSchema.questionId });
    // 把 answerId 寫回對應的 detail（給簡答題申訴用）
    const idByQuestion = new Map(insertedAnswers.map(a => [a.questionId, a.id]));
    for (const d of details) {
      const aid = idByQuestion.get(d.questionId);
      if (aid !== undefined) {
        d.answerId = aid;
      }
    }
  }

  return { responseId: inserted.id, score, totalPoints, details };
}

// ─── Phase C：老師複核簡答題 ────────────────────────────────────────────

/**
 * 計算單一 answer 的實得分（給重算 response.score 用）
 *
 * 規則：
 * - 非簡答題：isCorrect=true 給滿分，其餘 0
 * - 簡答題：
 *   - gradedBy='teacher' → isCorrect=true 給滿分，false 給 0（老師二元覆寫）
 *   - gradedBy='teacher_confirmed' → 用 aiScore（老師批次接受 AI 判定，保留部分分）
 *   - gradedBy='ai' / 沒 gradingMeta → 用 aiScore（AI 自動評分）
 */
function computeAwardedPoints(input: {
  isCorrect: boolean | null;
  gradingMeta: typeof answerSchema.$inferSelect.gradingMeta;
  questionType: string;
  questionPoints: number;
}): number {
  if (input.questionType === 'short_answer') {
    if (input.gradingMeta?.gradedBy === 'teacher') {
      return input.isCorrect === true ? input.questionPoints : 0;
    }
    return input.gradingMeta?.aiScore ?? 0;
  }
  return input.isCorrect === true ? input.questionPoints : 0;
}

/**
 * 老師複核簡答題：覆寫 AI 判定為 ✓（全分）或 ✗（0 分），自動重算 response.score
 *
 * Phase C MVP：採二元判定（全分 / 0 分），部分分留給 AI；老師若想給部分分，
 * 未來再加「自訂分數」UI。
 */
export async function gradeShortAnswerByTeacher(input: {
  answerId: number;
  isCorrect: boolean;
}): Promise<{ newScore: number; newTotalPoints: number; quizId: number }> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('未登入');
  }

  // 1. 找答案 + 對應 question + 驗 quiz 擁有權
  const [row] = await db
    .select({
      answer: {
        id: answerSchema.id,
        responseId: answerSchema.responseId,
        gradingMeta: answerSchema.gradingMeta,
        appealStatus: answerSchema.appealStatus,
      },
      question: {
        id: questionSchema.id,
        type: questionSchema.type,
        points: questionSchema.points,
        quizId: questionSchema.quizId,
      },
      quiz: {
        ownerId: quizSchema.ownerId,
      },
    })
    .from(answerSchema)
    .innerJoin(questionSchema, eq(answerSchema.questionId, questionSchema.id))
    .innerJoin(quizSchema, eq(questionSchema.quizId, quizSchema.id))
    .where(eq(answerSchema.id, input.answerId))
    .limit(1);

  if (!row) {
    throw new Error('找不到答案');
  }
  if (row.question.type !== 'short_answer') {
    throw new Error('僅簡答題可手動複核');
  }
  if (row.quiz.ownerId !== userId) {
    throw new Error('無權限複核此測驗');
  }

  // 2. 更新 answer：isCorrect + gradingMeta（保留 AI 原始 reason / confidence，標 gradedBy=teacher）
  const newGradingMeta = {
    reason: row.answer.gradingMeta?.reason ?? '',
    confidence: row.answer.gradingMeta?.confidence ?? 0,
    aiScore: input.isCorrect ? row.question.points : 0,
    gradedBy: 'teacher' as const,
    gradedAt: new Date().toISOString(),
  };

  // 若該答案有 pending 申訴，老師複核完自動結案；否則不動 appealStatus（避免覆寫從未申訴的 null）
  await db
    .update(answerSchema)
    .set({
      isCorrect: input.isCorrect,
      gradingMeta: newGradingMeta,
      ...(row.answer.appealStatus === 'pending' ? { appealStatus: 'resolved' as const } : {}),
    })
    .where(eq(answerSchema.id, input.answerId));

  // 3. 重算 response.score：拉該 response 所有 answer + question 資料
  const allAnswers = await db
    .select({
      isCorrect: answerSchema.isCorrect,
      gradingMeta: answerSchema.gradingMeta,
      qType: questionSchema.type,
      qPoints: questionSchema.points,
    })
    .from(answerSchema)
    .innerJoin(questionSchema, eq(answerSchema.questionId, questionSchema.id))
    .where(eq(answerSchema.responseId, row.answer.responseId));

  let newScore = 0;
  for (const a of allAnswers) {
    newScore += computeAwardedPoints({
      isCorrect: a.isCorrect,
      gradingMeta: a.gradingMeta,
      questionType: a.qType,
      questionPoints: a.qPoints,
    });
  }

  // 4. UPDATE response.score（totalPoints 不變：簡答題滿分在 submit 已加進去）
  const [updated] = await db
    .update(responseSchema)
    .set({ score: newScore })
    .where(eq(responseSchema.id, row.answer.responseId))
    .returning();

  // 5. revalidate 老師成績頁
  revalidatePath(`/dashboard/quizzes/${row.question.quizId}/results`);

  return {
    newScore: updated?.score ?? 0,
    newTotalPoints: updated?.totalPoints ?? 0,
    quizId: row.question.quizId,
  };
}

/**
 * 批次接受 AI 評分結果：把指定題目所有 gradedBy='ai' 的 answer 標記為 'teacher_confirmed'
 * 保留 aiScore 與 isCorrect（不重算對錯，等於老師蓋章認證 AI 判定）
 *
 * 用途：題目作答數多時，老師快速通過 AI 判定，不用每筆按按鈕
 */
export async function acceptAllAiGradesForQuestion(input: {
  questionId: number;
}): Promise<{ affected: number; quizId: number }> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('未登入');
  }

  // 1. 驗 question 屬於該老師的 quiz 且為簡答題
  const [question] = await db
    .select({
      id: questionSchema.id,
      type: questionSchema.type,
      points: questionSchema.points,
      quizId: questionSchema.quizId,
      ownerId: quizSchema.ownerId,
    })
    .from(questionSchema)
    .innerJoin(quizSchema, eq(questionSchema.quizId, quizSchema.id))
    .where(eq(questionSchema.id, input.questionId))
    .limit(1);

  if (!question) {
    throw new Error('找不到題目');
  }
  if (question.type !== 'short_answer') {
    throw new Error('僅簡答題可批次複核');
  }
  if (question.ownerId !== userId) {
    throw new Error('無權限');
  }

  // 2. 拉該題所有 gradedBy='ai' 的 answer
  const targets = await db
    .select({
      id: answerSchema.id,
      responseId: answerSchema.responseId,
      isCorrect: answerSchema.isCorrect,
      gradingMeta: answerSchema.gradingMeta,
    })
    .from(answerSchema)
    .where(eq(answerSchema.questionId, input.questionId));

  const aiOnly = targets.filter(a => a.gradingMeta?.gradedBy === 'ai');
  if (aiOnly.length === 0) {
    return { affected: 0, quizId: question.quizId };
  }

  // 3. 逐筆 update gradedBy='teacher_confirmed'（保留 aiScore / reason / confidence / isCorrect）
  //    不重算 response.score（aiScore 不變，總分不變）
  const nowIso = new Date().toISOString();
  await Promise.all(
    aiOnly.map(a =>
      db
        .update(answerSchema)
        .set({
          gradingMeta: {
            reason: a.gradingMeta!.reason,
            confidence: a.gradingMeta!.confidence,
            aiScore: a.gradingMeta!.aiScore,
            gradedBy: 'teacher_confirmed' as const,
            gradedAt: nowIso,
          },
        })
        .where(eq(answerSchema.id, a.id)),
    ),
  );

  revalidatePath(`/dashboard/quizzes/${question.quizId}/results`);

  return { affected: aiOnly.length, quizId: question.quizId };
}
