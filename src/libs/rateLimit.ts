/**
 * 公開（免登入）AI 端點限流。
 *
 * 這些端點學生不用登入就能打，原本沒有任何限制：一支簡單的 script 就能燒掉 OpenAI / Anthropic / Gemini 額度，
 * 而且共用的 key pool 被打爆時，付費老師的出題也會一起撞到 429。
 *
 * 做法：依「端點 + IP」做固定視窗計數，計數存在 Postgres（rate_limit 表，原子 upsert），
 * 不另外接 Redis。Serverless 多 instance 共用同一份計數，所以不會像 in-memory 限流一樣失效。
 *
 * 上限刻意設得寬：學校常是整間電腦教室共用一個對外 IP（NAT），一班 35 人同時作答也不能被擋。
 * 目標是擋掉「單一來源無限狂打」，不是精準控量。要調整就改 PUBLIC_AI_LIMITS。
 */
import { lt, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { rateLimitSchema } from '@/models/Schema';

export type RateLimitResult = {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterSec: number;
};

/** 每個端點在 windowSec 秒內，同一 IP 最多 limit 次 */
export const PUBLIC_AI_LIMITS = {
  'tts': { limit: 300, windowSec: 600 }, // 單字卡每張都會念，量最大
  'generate-flashcards': { limit: 40, windowSec: 600 },
  'hint-socratic': { limit: 200, windowSec: 600 }, // 錯題重做每題最多 3 輪
  'analyze-weak-points': { limit: 80, windowSec: 600 },
  'generate-remedial': { limit: 80, windowSec: 600 },
  'generate-hints': { limit: 120, windowSec: 600 },
  'adaptive-annotations': { limit: 200, windowSec: 600 },
  'adaptive-next-step': { limit: 400, windowSec: 600 }, // 每一步都會打，多數不會叫 AI
} as const satisfies Record<string, { limit: number; windowSec: number }>;

export type PublicAiBucket = keyof typeof PUBLIC_AI_LIMITS;

/** 取 client IP：Vercel 會把真實 IP 放在 x-forwarded-for 第一個 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** 固定視窗計數 +1，回傳是否還在上限內。now 可注入方便測試 */
export async function checkRateLimit(
  bucket: string,
  identifier: string,
  limit: number,
  windowSec: number,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const windowMs = windowSec * 1000;
  const windowStart = Math.floor(now.getTime() / windowMs) * windowMs;
  const windowEnd = windowStart + windowMs;
  const key = `${bucket}:${identifier}:${windowStart}`;

  const [row] = await db
    .insert(rateLimitSchema)
    .values({ key, count: 1, expiresAt: new Date(windowEnd) })
    .onConflictDoUpdate({
      target: rateLimitSchema.key,
      set: { count: sql`${rateLimitSchema.count} + 1` },
    })
    .returning();

  // 約 1% 的請求順手清掉過期列，避免表無限長大（失敗不影響本次請求）
  if (Math.random() < 0.01) {
    db.delete(rateLimitSchema).where(lt(rateLimitSchema.expiresAt, now)).catch(() => {});
  }

  const count = row?.count ?? 1;
  return {
    allowed: count <= limit,
    count,
    limit,
    retryAfterSec: Math.max(1, Math.ceil((windowEnd - now.getTime()) / 1000)),
  };
}

/**
 * route 開頭呼叫：超過上限回 429 response，沒超過回 null。
 * 限流本身出錯（例如 DB 暫時連不上）時放行，不讓限流變成整個功能的單點故障。
 */
export async function enforcePublicAiLimit(req: Request, bucket: PublicAiBucket): Promise<NextResponse | null> {
  const { limit, windowSec } = PUBLIC_AI_LIMITS[bucket];
  try {
    const result = await checkRateLimit(bucket, getClientIp(req), limit, windowSec);
    if (!result.allowed) {
      return NextResponse.json(
        { error: '請求太頻繁，請稍後再試' },
        { status: 429, headers: { 'Retry-After': String(result.retryAfterSec) } },
      );
    }
  } catch (err) {
    console.error(`[rateLimit] ${bucket} 限流檢查失敗，放行：`, err);
  }
  return null;
}
