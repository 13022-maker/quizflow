/**
 * GET /api/sim/:code — 學生端（hdfix3 HTML 的 QuizFlow 連線模式）取得練習設定（免登入）
 *   回傳 { title, mode, timeLimitMin, spec }；不回 ownerId 等老師資料。
 * :code 為 8 碼分享碼（accessCode），公開路由（middleware 白名單）。
 */
import { NextResponse } from 'next/server';

import { getSimPracticeByCode } from '@/libs/sim/dao';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { code: string } }) {
  try {
    const practice = await getSimPracticeByCode(params.code);
    if (!practice) {
      return NextResponse.json({ error: '找不到這個實作模擬，請確認連結是否正確' }, { status: 404 });
    }
    return NextResponse.json(
      {
        title: practice.title,
        mode: practice.mode,
        timeLimitMin: practice.timeLimitMin,
        spec: practice.spec,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[sim-api] GET 失敗：', error);
    return NextResponse.json({ error: '伺服器錯誤，請稍後再試' }, { status: 500 });
  }
}
