/**
 * 靜態練習頁匿名作答事件收集端點。
 *
 * POST /api/p/[id]/events   （[id] = practice_page_share.id）
 *   body: 單一事件 JSON（session_start / answer / complete / profile / lead），
 *   練習頁用 navigator.sendBeacon 以 text/plain 送出（fetch keepalive 備援），所以這裡讀 text 自己 parse。
 *
 * 公開、免登入（middleware.ts isPublicApiRoute 的 '/api/p/(.*)' 已涵蓋），route 內不呼叫 auth()。
 * 防濫用：
 *   1. body 大小上限 + Zod 白名單驗證（見 lib/practicePageEvents.ts）
 *   2. 分享連結不存在 → 404
 *   3. in-memory 限流（key = 雜湊過的 IP，只在記憶體、不落地）
 *   4. 每個 session 最多 MAX_EVENTS_PER_SESSION 筆事件、每個 session 最多 3 筆 email，超過靜默忽略
 * 不儲存 IP、User-Agent、cookie。練習頁那端所有失敗都會被吞掉，不影響作答。
 */
import { createHash } from 'node:crypto';

import { and, count, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { MAX_EVENT_BODY_BYTES, MAX_EVENTS_PER_SESSION, parsePracticePageEvent } from '@/lib/practicePageEvents';
import { createFixedWindowLimiter } from '@/lib/practicePageRateLimit';
import { db } from '@/libs/DB';
import { practicePageEventSchema, practicePageLeadSchema, practicePageShareSchema } from '@/models/Schema';

export const runtime = 'nodejs';

// 一個來源每分鐘最多 120 筆（20 題練習頁正常作答約 25 筆）
const limiter = createFixedWindowLimiter({ limit: 120, windowMs: 60_000 });
const MAX_LEADS_PER_SESSION = 3;

function clientKey(req: Request): string {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  // 只拿雜湊值當限流 key，原始 IP 不保存
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const shareId = Number(params.id);
  if (!Number.isInteger(shareId) || shareId <= 0) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  if (!limiter.hit(clientKey(req))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const declaredLength = Number(req.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_EVENT_BODY_BYTES) {
    return NextResponse.json({ ok: false }, { status: 413 });
  }

  const parsed = parsePracticePageEvent(await req.text());
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  try {
    const [share] = await db
      .select({ id: practicePageShareSchema.id, quizId: practicePageShareSchema.quizId })
      .from(practicePageShareSchema)
      .where(eq(practicePageShareSchema.id, shareId))
      .limit(1);
    if (!share) {
      return NextResponse.json({ ok: false }, { status: 404 });
    }

    const event = parsed.event;

    if (event.type === 'lead') {
      const [leadCount] = await db
        .select({ n: count() })
        .from(practicePageLeadSchema)
        .where(and(eq(practicePageLeadSchema.shareId, shareId), eq(practicePageLeadSchema.sessionId, event.sessionId)));
      if ((leadCount?.n ?? 0) >= MAX_LEADS_PER_SESSION) {
        return NextResponse.json({ ok: true, ignored: true });
      }
      await db
        .insert(practicePageLeadSchema)
        .values({ shareId, sessionId: event.sessionId, email: event.email, consentAt: new Date() })
        .onConflictDoNothing();
      return NextResponse.json({ ok: true });
    }

    const [eventCount] = await db
      .select({ n: count() })
      .from(practicePageEventSchema)
      .where(and(eq(practicePageEventSchema.shareId, shareId), eq(practicePageEventSchema.sessionId, event.sessionId)));
    if ((eventCount?.n ?? 0) >= MAX_EVENTS_PER_SESSION) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const { type, sessionId, ...payload } = event;
    await db.insert(practicePageEventSchema).values({
      shareId,
      quizId: share.quizId,
      sessionId,
      type,
      questionIndex: event.type === 'answer' ? event.questionIndex : null,
      questionId: event.type === 'answer' ? event.questionId : null,
      payload,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[practice-page events] 寫入失敗', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
