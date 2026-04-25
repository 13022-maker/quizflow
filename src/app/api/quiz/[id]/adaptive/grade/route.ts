/**
 * 自適應測驗：單題即時批改（學生端不持有正解，避免 DevTools 偷看）
 *
 * POST /api/quiz/[id]/adaptive/grade
 * Body: { questionId, answer: string | string[] }
 *
 * Returns: { isCorrect: boolean, correctAnswers?: string[] }
 *   - 適性模式為了體驗，這裡同時把正解回傳供 UI 顯示，因為「答完才回正解」不會被偷分
 */

import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { questionSchema, quizSchema } from '@/models/Schema';

export const runtime = 'nodejs';

const InputSchema = z.object({
  questionId: z.number().int().positive(),
  answer: z.union([z.string(), z.array(z.string())]),
});

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const quizId = Number(params.id);
  if (Number.isNaN(quizId)) {
    return NextResponse.json({ error: '無效的測驗 ID' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '格式錯誤' }, { status: 400 });
  }
  const { questionId, answer } = parsed.data;

  // 確認測驗開啟適性模式 + 該題確實屬於該測驗
  const [quiz] = await db
    .select({ adaptiveMode: quizSchema.adaptiveMode })
    .from(quizSchema)
    .where(eq(quizSchema.id, quizId))
    .limit(1);
  if (!quiz?.adaptiveMode) {
    return NextResponse.json({ error: '此測驗未開啟適性模式' }, { status: 400 });
  }

  const [question] = await db
    .select({
      type: questionSchema.type,
      correctAnswers: questionSchema.correctAnswers,
    })
    .from(questionSchema)
    .where(and(eq(questionSchema.id, questionId), eq(questionSchema.quizId, quizId)))
    .limit(1);

  if (!question) {
    return NextResponse.json({ error: '找不到題目' }, { status: 404 });
  }

  const correct = question.correctAnswers ?? [];
  let isCorrect = false;

  if (question.type === 'short_answer' || question.type === 'speaking') {
    // 簡答 / 口說題不適用 CAT 自動批改邏輯，預設給「答對」以避免影響 ability
    // （適性測驗應只配置選擇 / 是非 / 聽力 / 排序題）
    isCorrect = true;
  } else if (
    question.type === 'single_choice'
    || question.type === 'true_false'
    || question.type === 'listening'
  ) {
    isCorrect = typeof answer === 'string' && correct.includes(answer);
  } else if (question.type === 'multiple_choice') {
    const given = Array.isArray(answer) ? [...answer].sort() : [];
    const expected = [...correct].sort();
    isCorrect = JSON.stringify(given) === JSON.stringify(expected);
  } else if (question.type === 'ranking') {
    const given = Array.isArray(answer) ? answer : [];
    isCorrect = JSON.stringify(given) === JSON.stringify(correct);
  }

  return NextResponse.json({ isCorrect, correctAnswers: correct });
}
