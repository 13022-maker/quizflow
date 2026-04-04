'use server';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { answerSchema, questionSchema, responseSchema } from '@/models/Schema';

const SubmitSchema = z.object({
  quizId: z.number().int().positive(),
  studentName: z.string().max(100).optional(),
  studentEmail: z.string().email().max(200).optional(),
  // { questionId: answer } — answer 是 string（簡答/是非）或 string[]（選擇題）
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
});

export type SubmitInput = z.infer<typeof SubmitSchema>;

export type SubmitResult = {
  responseId: number;
  score: number;
  totalPoints: number;
  details: {
    questionId: number;
    isCorrect: boolean | null;  // null = 簡答題
    points: number;
  }[];
};

export async function submitQuizResponse(data: SubmitInput): Promise<SubmitResult> {
  const parsed = SubmitSchema.safeParse(data);
  if (!parsed.success) throw new Error('格式錯誤');

  const { quizId, studentName, studentEmail, answers } = parsed.data;

  // 取得所有題目的正確答案與配分
  const questions = await db
    .select()
    .from(questionSchema)
    .where(eq(questionSchema.quizId, quizId));

  if (questions.length === 0) throw new Error('找不到題目');

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
      if (question.type === 'single_choice' || question.type === 'true_false') {
        isCorrect = correct.includes(studentAnswer as string);
      } else if (question.type === 'multiple_choice') {
        const given = Array.isArray(studentAnswer) ? [...studentAnswer].sort() : [];
        const expected = [...correct].sort();
        isCorrect = JSON.stringify(given) === JSON.stringify(expected);
      }
    }

    if (!isShortAnswer) totalPoints += question.points;
    if (isCorrect === true) score += question.points;

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
    })
    .returning();

  if (!inserted) throw new Error('儲存失敗');

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

  return { responseId: inserted.id, score, totalPoints, details };
}
