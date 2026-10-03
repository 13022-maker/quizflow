import { NextResponse } from 'next/server';
import { z } from 'zod';

import { recordBuzzAnswer } from '@/services/live/buzzerStore';
import { verifyPlayerToken } from '@/services/live/liveStore';

export const runtime = 'nodejs';

// 小組搶答：持有作答權的學生送出答案（server 端判對錯、計組分）
const BodySchema = z.object({
  playerId: z.number().int().positive(),
  playerToken: z.string().min(1),
  questionId: z.number().int().positive(),
  selectedOptionId: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
});

export async function POST(
  request: Request,
  { params }: { params: { gameId: string } },
) {
  const gameId = Number(params.gameId);
  if (!Number.isFinite(gameId) || gameId <= 0) {
    return NextResponse.json({ error: 'Bad gameId' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? '資料格式錯誤' },
      { status: 400 },
    );
  }

  const verified = await verifyPlayerToken(gameId, parsed.data.playerToken);
  if (!verified || verified.playerId !== parsed.data.playerId) {
    return NextResponse.json({ error: '身分驗證失敗' }, { status: 401 });
  }

  const result = await recordBuzzAnswer({
    gameId,
    playerId: parsed.data.playerId,
    questionId: parsed.data.questionId,
    selectedOptionId: parsed.data.selectedOptionId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
  }

  return NextResponse.json({ isCorrect: result.isCorrect, delta: result.delta });
}
