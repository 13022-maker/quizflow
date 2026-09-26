// src/app/api/review/[gameId]/score/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { upsertScore, verifyPlayerToken } from '@/services/review/reviewStore';

export const runtime = 'nodejs';

const BodySchema = z.object({
  playerId: z.number().int().positive(),
  playerToken: z.string().min(1),
  sampleId: z.number().int().positive(),
  correctness: z.number().int().min(0).max(5),
  completeness: z.number().int().min(0).max(5),
  clarity: z.number().int().min(0).max(5),
  creativity: z.number().int().min(0).max(5),
  comment: z.string().trim().max(200, '短評最多 200 字').nullable().optional(),
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
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? '資料格式錯誤' }, { status: 400 });
  }

  const verified = await verifyPlayerToken(gameId, parsed.data.playerToken);
  if (!verified || verified.playerId !== parsed.data.playerId) {
    return NextResponse.json({ error: '身分驗證失敗' }, { status: 401 });
  }

  const result = await upsertScore({
    gameId,
    playerId: parsed.data.playerId,
    sampleId: parsed.data.sampleId,
    scores: {
      correctness: parsed.data.correctness,
      completeness: parsed.data.completeness,
      clarity: parsed.data.clarity,
      creativity: parsed.data.creativity,
    },
    comment: parsed.data.comment ?? null,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }
  return NextResponse.json({ ok: true });
}
