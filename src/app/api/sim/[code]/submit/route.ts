/**
 * POST /api/sim/:code/submit — 學生送出成績（免登入）
 *   body: SimResultPayload（hdfix3 成績 JSON，v:1、exam:'hdfix3'）
 *   - exam 模式：每次交卷新增一筆（attemptNo + 1、isFinal = true）
 *   - practice 模式：每通過一題送一次最新進度，upsert（attemptNo = 1、isFinal = false）
 *   分數一律由 server 依 items 重算，不採信 client 的 score。
 *   回傳 { ok: true, score, attemptNo }
 * 限流：同一 IP 每分鐘 60 次（學校整間電腦教室常共用一個對外 IP，不能設太緊）。
 */
import { NextResponse } from 'next/server';

import { checkRateLimit, getClientIp } from '@/libs/rateLimit';
import { getSimPracticeByCode, insertExamSubmission, upsertPracticeProgress } from '@/libs/sim/dao';
import { parseSimResult } from '@/libs/sim/result';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 整班常共用學校同一個對外 IP（NAT），40 人練習時每人每分鐘數次回報，上限放寬到 300
const SUBMIT_LIMIT = 300;
const SUBMIT_WINDOW_SEC = 60;
const MAX_BODY_BYTES = 32 * 1024; // 正常成績 JSON 約 1~2 KB

export async function POST(request: Request, { params }: { params: { code: string } }) {
  // 限流本身出錯（DB 暫時連不上）時放行，比照 enforcePublicAiLimit
  try {
    const rl = await checkRateLimit('sim-submit', getClientIp(request), SUBMIT_LIMIT, SUBMIT_WINDOW_SEC);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: '請求太頻繁，請稍後再試' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }
  } catch (err) {
    console.error('[sim-api] 限流檢查失敗，放行：', err);
  }

  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: '資料太大' }, { status: 413 });
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: '資料格式錯誤（不是 JSON）' }, { status: 400 });
    }

    const parsed = parseSimResult(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const practice = await getSimPracticeByCode(params.code);
    if (!practice) {
      return NextResponse.json({ error: '找不到這個實作模擬，請確認連結是否正確' }, { status: 404 });
    }

    const row = practice.mode === 'exam'
      ? await insertExamSubmission(practice.id, parsed.value)
      : await upsertPracticeProgress(practice.id, parsed.value);

    return NextResponse.json({ ok: true, score: parsed.value.score, attemptNo: row.attemptNo });
  } catch (error) {
    console.error('[sim-api] submit 失敗：', error);
    return NextResponse.json({ error: '伺服器錯誤，請稍後再試' }, { status: 500 });
  }
}
