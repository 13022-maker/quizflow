import { NextResponse } from 'next/server';
import { z } from 'zod';

import { publishToGame, publishToPlayer } from '@/libs/ably/server';
import {
  getCurrentAnsweredCount,
  getCurrentQuestionId,
  getPlayerTotals,
  getSlimLeaderboard,
  recordAnswer,
  tryClaimLeaderboardPublish,
  verifyPlayerToken,
} from '@/services/live/liveStore';
import {
  type AnswerSubmittedPayload,
  type LeaderboardUpdatePayload,
  LiveGameEvent,
  LivePlayerEvent,
} from '@/services/live/types';

export const runtime = 'nodejs';

const BodySchema = z.object({
  playerId: z.number().int().positive(),
  playerToken: z.string().min(1),
  questionId: z.number().int().positive(),
  selectedOptionId: z.union([z.string(), z.array(z.string())]),
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

  const result = await recordAnswer({
    gameId,
    playerId: parsed.data.playerId,
    questionId: parsed.data.questionId,
    selectedOptionId: parsed.data.selectedOptionId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  // ── 背景發 Ably 事件：一律 swallow 失敗，不可阻斷 client 回應 ──
  // 1. 個別推 answer:submitted 到該玩家私人 channel（含累計分數）
  // 2. 搶到節流權時才推 leaderboard:update 公開給全場
  const totals = await getPlayerTotals(parsed.data.playerId);
  const answerPayload: AnswerSubmittedPayload = {
    questionId: parsed.data.questionId,
    isCorrect: result.isCorrect,
    score: result.score,
    totalScore: totals?.score ?? result.score,
    correctCount: totals?.correctCount ?? (result.isCorrect ? 1 : 0),
  };
  const publishPromises: Promise<unknown>[] = [
    publishToPlayer(
      gameId,
      parsed.data.playerId,
      LivePlayerEvent.AnswerSubmitted,
      answerPayload,
    ),
  ];

  const claimed = await tryClaimLeaderboardPublish(gameId);
  if (claimed) {
    const currentQid = await getCurrentQuestionId(gameId);
    const [players, answeredCount] = await Promise.all([
      getSlimLeaderboard(gameId),
      currentQid ? getCurrentAnsweredCount(gameId, currentQid) : Promise.resolve(0),
    ]);
    const payload: LeaderboardUpdatePayload = { players, answeredCount };
    publishPromises.push(
      publishToGame(gameId, LiveGameEvent.LeaderboardUpdate, payload),
    );
  }

  // 背景跑完不 block response（fire-and-forget）
  Promise.all(publishPromises).catch((err) => {
    console.error('[answer] ably publish failed', err);
  });

  return NextResponse.json({
    isCorrect: result.isCorrect,
    score: result.score,
  });
}
