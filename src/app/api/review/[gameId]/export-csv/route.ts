import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { reviewGameSchema } from '@/models/Schema';
import { getHostState } from '@/services/review/reviewStore';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: { gameId: string } },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  const gameId = Number(params.gameId);
  if (!Number.isFinite(gameId) || gameId <= 0) {
    return NextResponse.json({ error: '無效的活動 ID' }, { status: 400 });
  }

  const [game] = await db
    .select({ hostUserId: reviewGameSchema.hostUserId })
    .from(reviewGameSchema)
    .where(eq(reviewGameSchema.id, gameId))
    .limit(1);
  if (!game || game.hostUserId !== userId) {
    return NextResponse.json({ error: '找不到活動或無權限' }, { status: 404 });
  }

  const state = await getHostState(gameId);
  if (!state || !state.resultsDetail) {
    return NextResponse.json({ error: '活動尚未結算，無法匯出' }, { status: 409 });
  }

  const header = ['組別', '總分', '準確度分', '速度加成', '投票加成', '收到票數', '創作答案'];
  const rows = state.resultsDetail.map((detail) => {
    const team = state.teams.find(t => t.id === detail.teamId);
    return [
      team?.teamName ?? `組別 ${detail.teamId}`,
      String(team?.score ?? 0),
      String(detail.accuracyScore),
      String(detail.speedBonus),
      String(detail.voteBonus),
      String(detail.votesReceived),
      detail.submission ?? '（未提交）',
    ];
  });

  const csvContent = [header, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const bom = '﻿';
  const filename = `協作批閱_${gameId}_成績.csv`;

  return new Response(bom + csvContent, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
