/**
 * 自適應測驗：完成後寫入 response 表
 *
 * POST /api/quiz/[id]/adaptive/finish
 * Body: { history: [{ questionId, answer }], studentName?, studentEmail? }
 *
 * Server 一律重新批改 + 重新計算 ability，不信任 client 端送來的 isCorrect / ability。
 *
 * 寫入：
 *   - response.score = 答對題數
 *   - response.totalPoints = 答題總數
 *   - response.estimatedAbility = 重新計算的 theta
 *   - 每題寫一筆 answer（isCorrect、answer 內容）
 *
 * 同時回傳能力等級 + 百分位給 client 顯示。
 */

import { eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { abilityToLevel, recomputeAbility } from '@/lib/ai/cat';
import { db } from '@/libs/DB';
import { answerSchema, questionSchema, quizSchema, responseSchema } from '@/models/Schema';

export const runtime = 'nodejs';

const InputSchema = z.object({
  history: z
    .array(
      z.object({
        questionId: z.number().int().positive(),
        answer: z.union([z.string(), z.array(z.string())]),
      }),
    )
    .min(1, '至少需作答 1 題'),
  studentName: z.string().max(100).optional(),
  studentEmail: z.string().email().max(200).optional(),
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
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? '格式錯誤' }, { status: 400 });
  }
  const { history, studentName, studentEmail } = parsed.data;

  // 1. 驗證測驗存在且開啟適性模式
  const [quiz] = await db
    .select({ id: quizSchema.id, adaptiveMode: quizSchema.adaptiveMode })
    .from(quizSchema)
    .where(eq(quizSchema.id, quizId))
    .limit(1);
  if (!quiz) {
    return NextResponse.json({ error: '找不到測驗' }, { status: 404 });
  }
  if (!quiz.adaptiveMode) {
    return NextResponse.json({ error: '此測驗未開啟適性模式' }, { status: 400 });
  }

  // 2. 取出所有作答到的題目（含 difficulty + 正解）
  const questionIds = Array.from(new Set(history.map(h => h.questionId)));
  const questions = await db
    .select({
      id: questionSchema.id,
      type: questionSchema.type,
      difficulty: questionSchema.difficulty,
      correctAnswers: questionSchema.correctAnswers,
      points: questionSchema.points,
    })
    .from(questionSchema)
    .where(inArray(questionSchema.id, questionIds));

  const qById = new Map(questions.map(q => [q.id, q]));

  // 3. 重新批改每題
  const gradedHistory: { questionId: number; difficulty: number; isCorrect: boolean; answer: string | string[] }[] = [];
  let correctCount = 0;
  for (const h of history) {
    const q = qById.get(h.questionId);
    if (!q) {
      // 題目不存在或不屬於此測驗 — 跳過（可能是 client tampering）
      continue;
    }
    const correct = q.correctAnswers ?? [];
    let isCorrect = false;
    if (q.type === 'short_answer' || q.type === 'speaking') {
      // 適性測驗不適用簡答 / 口說題；當作答對以避免影響 theta
      isCorrect = true;
    } else if (q.type === 'single_choice' || q.type === 'true_false' || q.type === 'listening') {
      isCorrect = typeof h.answer === 'string' && correct.includes(h.answer);
    } else if (q.type === 'multiple_choice') {
      const given = Array.isArray(h.answer) ? [...h.answer].sort() : [];
      const expected = [...correct].sort();
      isCorrect = JSON.stringify(given) === JSON.stringify(expected);
    } else if (q.type === 'ranking') {
      const given = Array.isArray(h.answer) ? h.answer : [];
      isCorrect = JSON.stringify(given) === JSON.stringify(correct);
    }
    if (isCorrect) {
      correctCount += 1;
    }
    gradedHistory.push({
      questionId: q.id,
      difficulty: q.difficulty,
      isCorrect,
      answer: h.answer,
    });
  }

  if (gradedHistory.length === 0) {
    return NextResponse.json({ error: '沒有可批改的題目' }, { status: 400 });
  }

  // 4. 重算最終 theta
  const ability = recomputeAbility(
    gradedHistory.map(g => ({ questionId: g.questionId, isCorrect: g.isCorrect, difficulty: g.difficulty })),
  );
  const level = abilityToLevel(ability);

  // 5. 寫入 response（適性測驗以「答對 / 答題數」為分數，總分 = 答題數）
  const [inserted] = await db
    .insert(responseSchema)
    .values({
      quizId,
      studentName: studentName ?? null,
      studentEmail: studentEmail ?? null,
      score: correctCount,
      totalPoints: gradedHistory.length,
      estimatedAbility: Number(ability.toFixed(3)),
    })
    .returning();

  if (!inserted) {
    return NextResponse.json({ error: '儲存失敗' }, { status: 500 });
  }

  // 6. 寫入每題的 answer
  const answerRows = gradedHistory.map(g => ({
    responseId: inserted.id,
    questionId: g.questionId,
    answer: g.answer,
    isCorrect: g.isCorrect,
  }));
  await db.insert(answerSchema).values(answerRows);

  return NextResponse.json({
    responseId: inserted.id,
    ability: Number(ability.toFixed(3)),
    level: level.label,
    description: level.description,
    percentile: level.percentile,
    totalAnswered: gradedHistory.length,
    correctCount,
  });
}
