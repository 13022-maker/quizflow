// 發 Ably token request：host 與 player 分開驗身分；兩者都只拿 subscribe
// capability，不給 publish（所有事件都由 server REST publish，避免 client 偽造）。

import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { gameChannel, playerChannel } from '@/libs/ably/channels';
import { createTokenRequest } from '@/libs/ably/server';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { liveGameSchema } from '@/models/Schema';
import { verifyPlayerToken } from '@/services/live/liveStore';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  if (!Env.ABLY_API_KEY) {
    return NextResponse.json(
      { error: 'ABLY_API_KEY 未設定' },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const role = searchParams.get('role');
  const gameId = Number(searchParams.get('gameId') ?? '');
  if (!role || !Number.isFinite(gameId) || gameId <= 0) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const gameCh = gameChannel(gameId);

  if (role === 'host') {
    const { orgId, userId } = await auth();
    if (!orgId || !userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const [game] = await db
      .select({ hostOrgId: liveGameSchema.hostOrgId })
      .from(liveGameSchema)
      .where(
        and(
          eq(liveGameSchema.id, gameId),
          eq(liveGameSchema.hostOrgId, orgId),
        ),
      )
      .limit(1);
    if (!game) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const tokenRequest = await createTokenRequest({
      clientId: `host:${userId}`,
      capability: { [gameCh]: ['subscribe'] },
    });
    if (!tokenRequest) {
      return NextResponse.json({ error: 'Ably 未啟用' }, { status: 503 });
    }
    return NextResponse.json(tokenRequest);
  }

  if (role === 'player') {
    const playerId = Number(searchParams.get('playerId') ?? '');
    const playerToken = searchParams.get('playerToken') ?? '';
    if (!Number.isFinite(playerId) || playerId <= 0 || !playerToken) {
      return NextResponse.json(
        { error: '缺少身分資訊' },
        { status: 400 },
      );
    }
    const verified = await verifyPlayerToken(gameId, playerToken);
    if (!verified || verified.playerId !== playerId) {
      return NextResponse.json({ error: '身分驗證失敗' }, { status: 401 });
    }
    const tokenRequest = await createTokenRequest({
      clientId: `player:${playerId}`,
      capability: {
        [gameCh]: ['subscribe'],
        [playerChannel(gameId, playerId)]: ['subscribe'],
      },
    });
    if (!tokenRequest) {
      return NextResponse.json({ error: 'Ably 未啟用' }, { status: 503 });
    }
    return NextResponse.json(tokenRequest);
  }

  return NextResponse.json({ error: 'Unknown role' }, { status: 400 });
}
