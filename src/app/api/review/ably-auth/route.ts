// src/app/api/review/ably-auth/route.ts
// 協作批閱 Ably token 端點：host 角色驗 Clerk userId，player 角色驗 playerToken
import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { reviewGameSchema } from '@/models/Schema';
import { createAblyTokenRequest, isAblyEnabled } from '@/services/review/ablyServer';
import { verifyPlayerToken } from '@/services/review/reviewStore';

export const runtime = 'nodejs';

const HostQuery = z.object({
  role: z.literal('host'),
  gameId: z.string().regex(/^\d+$/),
});

const PlayerQuery = z.object({
  role: z.literal('player'),
  gameId: z.string().regex(/^\d+$/),
  playerId: z.string().regex(/^\d+$/),
  playerToken: z.string().min(1),
});

export async function GET(request: Request) {
  if (!isAblyEnabled()) {
    return NextResponse.json({ error: 'Ably 未啟用（ABLY_API_KEY 未設定）' }, { status: 503 });
  }

  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());

  if (params.role === 'host') {
    const parsed = HostQuery.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }
    const gameId = Number(parsed.data.gameId);
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }
    const [game] = await db
      .select({ hostUserId: reviewGameSchema.hostUserId })
      .from(reviewGameSchema)
      .where(eq(reviewGameSchema.id, gameId))
      .limit(1);
    if (!game || game.hostUserId !== userId) {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }
    const tokenRequest = await createAblyTokenRequest({ gameId, clientId: `host:${userId}:${gameId}` });
    return NextResponse.json(tokenRequest);
  }

  if (params.role === 'player') {
    const parsed = PlayerQuery.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }
    const gameId = Number(parsed.data.gameId);
    const playerId = Number(parsed.data.playerId);
    const verified = await verifyPlayerToken(gameId, parsed.data.playerToken);
    if (!verified || verified.playerId !== playerId) {
      return NextResponse.json({ error: '身分驗證失敗' }, { status: 403 });
    }
    const tokenRequest = await createAblyTokenRequest({ gameId, clientId: `player:${gameId}:${playerId}` });
    return NextResponse.json(tokenRequest);
  }

  return NextResponse.json({ error: 'role 必須為 host 或 player' }, { status: 400 });
}
