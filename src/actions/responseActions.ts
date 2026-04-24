'use server';

import { and, count, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { answerSchema, questionSchema, quizSchema, responseSchema } from '@/models/Schema';

// 口說題的單題評量結果（client 端從 /api/ai/grade-speech 拿到再送回來）
const SpeechAssessmentSchema = z.object({
  audioUrl: z.string(),
  transcript: z.string(),
  durationSeconds: z.number().nonnegative(),
  language: z.string(),
  scores: z.object({
    pronunciation: z.number().min(0).max(100),
    fluency: z.number().min(0).max(100),
    content: z.number().min(0).max(100),
    overall: z.number().min(0).max(100),
  }),
  feedback: z.string().max(500).default(''),
});

const SubmitSchema = z.object({
  quizId: z.number().int().positive(),
  studentName: z.string().max(100).optional(),
  studentEmail: z.string().email().max(200).optional(),
  // { questionId: answer } — answer 是 string（簡答/是非）或 string[]（選擇題/排序題）
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  // 考試防作弊：學生離開頁面次數（preventLeave 開啟時才有意義）
  leaveCount: z.number().int().min(0).optional(),
  // 口說題評量結果：{ questionId: assessment }
  speechAssessments: z.record(z.string(), SpeechAssessmentSchema).optional(),
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

  const { quizId, studentName, studentEmail, answers, leaveCount, speechAssessments } = parsed.data;

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
    const isSpeaking = question.type === 'speaking';

    let isCorrect: boolean | null = null;

    if (isSpeaking) {
      // 口說題：依 AI 評分的 overallScore（0–100）按比例給分
      const assessment = speechAssessments?.[question.id.toString()];
      if (assessment) {
        const ratio = assessment.scores.overall / 100;
        const earned = Math.round(question.points * ratio);
        score += earned;
        totalPoints += question.points;
        // overall ≥ 60 視為「答對」標記，方便老師端統計
        isCorrect = assessment.scores.overall >= 60;
        details.push({ questionId: question.id, isCorrect, points: earned });
      } else {
        // 學生未完成口說評分（理論上前端已擋）：給 0 分但仍計入滿分
        totalPoints += question.points;
        details.push({ questionId: question.id, isCorrect: false, points: 0 });
      }
      continue;
    }

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

  // 寫入每題的 answer
  const answerRows = questions
    .filter((q) => {
      const hasText = answers[q.id.toString()] !== undefined;
      const hasSpeech = q.type === 'speaking' && !!speechAssessments?.[q.id.toString()];
      return hasText || hasSpeech;
    })
    .map((q) => {
      const detail = details.find(d => d.questionId === q.id)!;
      const speech = q.type === 'speaking' ? speechAssessments?.[q.id.toString()] : undefined;
      return {
        responseId: inserted.id,
        questionId: q.id,
        // 口說題的「answer」字串存逐字稿，讓老師成績頁可一眼看到學生說了什麼
        answer: speech
          ? speech.transcript
          : (answers[q.id.toString()] as string | string[]),
        isCorrect: detail.isCorrect,
        audioUrl: speech?.audioUrl ?? null,
        speechAssessment: speech
          ? {
              transcript: speech.transcript,
              pronunciationScore: speech.scores.pronunciation,
              fluencyScore: speech.scores.fluency,
              contentScore: speech.scores.content,
              overallScore: speech.scores.overall,
              feedback: speech.feedback,
              language: speech.language,
            }
          : null,
      };
    });

  if (answerRows.length > 0) {
    await db.insert(answerSchema).values(answerRows);
  }

  return { responseId: inserted.id, score, totalPoints, details };
}
