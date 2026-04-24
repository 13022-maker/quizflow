/**
 * 自適應測驗：取得「下一題」
 *
 * POST /api/quiz/[id]/adaptive/next
 * Body: { history: [{ questionId: number, isCorrect: boolean }] }
 *
 * Returns:
 *   - { done: true, ability, level, percentile, totalAnswered }
 *     收斂 / 達標 / 題庫耗盡時回傳
 *   - { done: false, question: Question, ability, totalAnswered, target }
 *     繼續作答時回傳
 *
 * 設計：完全 stateless。client 端在 sessionStorage 維護 history，
 * 每答完一題就 POST 一次拿下一題。Server 端依靠 history 重算 theta。
 *
 * 學生公開作答頁不走 Clerk auth；以 quiz.adaptiveMode 是否開啟做基本守門。
 */

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/libs/DB';
import {
  abilityToLevel,
  recomputeAbility,
  selectNextQuestion,
  shouldStop,
} from '@/lib/ai/cat';
import { questionSchema, quizSchema } from '@/models/Schema';

export const runtime = 'nodejs';

const InputSchema = z.object({
  history: z.array(
    z.object({
      questionId: z.number().int().positive(),
      isCorrect: z.boolean(),
    }),
  ).default([]),
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
  const { history } = parsed.data;

  // 1. 確認測驗存在 + 開啟適性模式
  const [quiz] = await db
    .select({
      id: quizSchema.id,
      adaptiveMode: quizSchema.adaptiveMode,
      adaptiveTargetCount: quizSchema.adaptiveTargetCount,
      status: quizSchema.status,
    })
    .from(quizSchema)
    .where(eq(quizSchema.id, quizId))
    .limit(1);

  if (!quiz) {
    return NextResponse.json({ error: '找不到測驗' }, { status: 404 });
  }
  if (!quiz.adaptiveMode) {
    return NextResponse.json({ error: '此測驗未開啟適性模式' }, { status: 400 });
  }

  // 2. 取出題庫（含 difficulty）
  const pool = await db
    .select({
      id: questionSchema.id,
      difficulty: questionSchema.difficulty,
    })
    .from(questionSchema)
    .where(eq(questionSchema.quizId, quizId));

  if (pool.length === 0) {
    return NextResponse.json({ error: '此測驗尚未建立題目' }, { status: 400 });
  }

  // 3. 過濾出 history 中真的存在於本測驗的記錄（防 client 偽造別測驗的 question id）
  const poolIds = new Set(pool.map(q => q.id));
  const validHistory = history
    .filter(h => poolIds.has(h.questionId))
    .map((h) => {
      const q = pool.find(p => p.id === h.questionId)!;
      return { questionId: h.questionId, isCorrect: h.isCorrect, difficulty: q.difficulty };
    });

  // 4. 計算當前 theta
  const ability = recomputeAbility(validHistory);

  // 5. 是否該停止
  const stop = shouldStop(validHistory, pool.length, quiz.adaptiveTargetCount);
  if (stop.stop) {
    const level = abilityToLevel(ability);
    return NextResponse.json({
      done: true,
      reason: stop.reason,
      ability: Number(ability.toFixed(3)),
      level: level.label,
      description: level.description,
      percentile: level.percentile,
      totalAnswered: validHistory.length,
    });
  }

  // 6. 挑下一題
  const answeredIds = new Set(validHistory.map(h => h.questionId));
  const next = selectNextQuestion(pool, answeredIds, ability);
  if (!next) {
    // 理論上不會到這裡（前面 shouldStop 已 cover），但防呆
    const level = abilityToLevel(ability);
    return NextResponse.json({
      done: true,
      reason: 'pool',
      ability: Number(ability.toFixed(3)),
      level: level.label,
      description: level.description,
      percentile: level.percentile,
      totalAnswered: validHistory.length,
    });
  }

  // 7. 撈該題完整內容（含 options 等）
  const [question] = await db
    .select()
    .from(questionSchema)
    .where(eq(questionSchema.id, next.id))
    .limit(1);

  if (!question) {
    return NextResponse.json({ error: '題目讀取失敗' }, { status: 500 });
  }

  // 不洩漏正解給 client（防 DevTools 偷答案）
  const safeQuestion: Record<string, unknown> = { ...question };
  delete safeQuestion.correctAnswers;

  return NextResponse.json({
    done: false,
    question: safeQuestion,
    ability: Number(ability.toFixed(3)),
    totalAnswered: validHistory.length,
    target: quiz.adaptiveTargetCount,
  });
}
