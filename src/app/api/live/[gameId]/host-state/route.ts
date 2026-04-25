import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { liveGameSchema } from '@/models/Schema';
import { getHostState } from '@/services/live/liveStore';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: { gameId: string } },
) {
  const gameId = Number(params.gameId);
  if (!Number.isFinite(gameId) || gameId <= 0) {
    return NextResponse.json({ error: 'Bad gameId' }, { status: 400 });
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [game] = await db
    .select({ hostUserId: liveGameSchema.hostUserId })
    .from(liveGameSchema)
    .where(eq(liveGameSchema.id, gameId))
    .limit(1);
  if (!game) {
    return NextResponse.json({ error: '找不到這場直播' }, { status: 404 });
  }
  if (game.hostUserId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const state = await getHostState(gameId);
  if (!state) {
    return NextResponse.json({ error: '找不到這場直播' }, { status: 404 });
  }

  return NextResponse.json(state);
}
