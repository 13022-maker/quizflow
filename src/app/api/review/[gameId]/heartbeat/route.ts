// src/app/api/review/[gameId]/heartbeat/route.ts
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { reviewPlayerSchema } from '@/models/Schema';

export const runtime = 'nodejs';

// 學生端每 5s 打一次，更新 review_player.last_seen_at（跟 Live Mode heartbeat 同款）
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

  const result = await db
    .update(reviewPlayerSchema)
    .set({ lastSeenAt: new Date() })
    .where(and(eq(reviewPlayerSchema.gameId, gameId), eq(reviewPlayerSchema.playerToken, playerToken)))
    .returning();

  if (result.length === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
