import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { livePlayerSchema } from '@/models/Schema';

export const runtime = 'nodejs';

// 學生端每 5s 打一次，更新 live_player.last_seen_at
// 安全：playerToken 是 server 產生的隨機字串，攻擊者拿到也只能更新時戳，無法改分或答題
export async function POST(
  request: Request,
  { params }: { params: { gameId: string } },
) {
  const playerToken = request.headers.get('x-player-token');
  if (!playerToken) {
    return NextResponse.json({ error: 'missing_token' }, { status: 401 });
  }

  const gameId = Number(params.gameId);
  if (!Number.isFinite(gameId) || gameId <= 0) {
    return NextResponse.json({ error: 'invalid_game' }, { status: 400 });
  }

  // 用 (gameId, playerToken) 雙 key update 防跨 game 偽造
  const result = await db
    .update(livePlayerSchema)
    .set({ lastSeenAt: new Date() })
    .where(
      and(
        eq(livePlayerSchema.gameId, gameId),
        eq(livePlayerSchema.playerToken, playerToken),
      ),
    )
    .returning();

  if (result.length === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
