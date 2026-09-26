import { NextResponse } from 'next/server';

import { getTeamState, verifyPlayerToken } from '@/services/review/reviewStore';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: { gameId: string } },
) {
  const gameId = Number(params.gameId);
  if (!Number.isFinite(gameId) || gameId <= 0) {
    return NextResponse.json({ error: 'Bad gameId' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const playerId = Number(searchParams.get('playerId') ?? '');
  const token = searchParams.get('token') ?? '';
  if (!Number.isFinite(playerId) || playerId <= 0 || !token) {
    return NextResponse.json({ error: '缺少身分資訊' }, { status: 400 });
  }

  const verified = await verifyPlayerToken(gameId, token);
  if (!verified || verified.playerId !== playerId) {
    return NextResponse.json({ error: '身分驗證失敗' }, { status: 401 });
  }

  const state = await getTeamState(gameId, playerId);
  if (!state) {
    return NextResponse.json({ error: '找不到這個活動' }, { status: 404 });
  }

  return NextResponse.json(state);
}
