// Self-healing tick endpoint
//
// Serverless 環境（Vercel）沒有常駐 timer，所以倒數結束時的 phase 推進靠 client 觸發：
// host 與所有 player 的 hook 在本地時間到 questionEndsAt 時 POST 此 endpoint。
// server 端用 atomic UPDATE WHERE status='playing' AND question_ends_at <= NOW() 推進 phase=locked。
// 第一個到的 client 贏，其餘收到 changed=false（no-op）。
//
// 這個 endpoint **沒有 mutation 副作用**（除了 phase 自然到時的轉換），
// 因此設計成公開（不需 auth），只需 gameId 路徑參數。

import { NextResponse } from 'next/server';

import { tickLockExpired } from '@/services/live/liveStore';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: { gameId: string } },
) {
  const gameId = Number(params.gameId);
  if (!Number.isFinite(gameId) || gameId <= 0) {
    return NextResponse.json({ error: 'Bad gameId' }, { status: 400 });
  }

  const result = await tickLockExpired(gameId);
  return NextResponse.json({
    changed: result.changed,
    seq: result.seq,
  });
}
