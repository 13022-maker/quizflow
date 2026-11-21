/**
 * Paddle 設定純函數（不 import DB / SDK，client 與 server 都可用、可單獨測試）
 *
 * - Price ID 一律從 env 讀，不寫死 sandbox / production ID
 * - env 缺漏時：前端按鈕顯示「即將開放」、API 回 503 + 清楚錯誤碼，build 與頁面都不會炸
 */

export type PaddlePriceIds = {
  proMonthly?: string;
  proYearly?: string;
  teamMonthly?: string;
  teamYearly?: string;
  publisherMonthly?: string;
  publisherYearly?: string;
};

export type PaidPlanKey = 'pro' | 'team' | 'publisher';

/**
 * 讀取 NEXT_PUBLIC_PADDLE_* env。
 * 注意：必須逐一寫出 `process.env.NEXT_PUBLIC_XXX` 字面量，Next.js 才會在 client bundle inline。
 */
export function readPaddlePublicEnv() {
  return {
    clientToken: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN,
    environment: process.env.NEXT_PUBLIC_PADDLE_ENV === 'production' ? 'production' : 'sandbox',
    priceIds: {
      proMonthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO_MONTHLY,
      proYearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO_YEARLY,
      teamMonthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_TEAM_MONTHLY,
      teamYearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_TEAM_YEARLY,
      // Publisher 方案（Phase 2）：Price ID 待使用者到 Paddle Dashboard 手動建立後填入 env
      publisherMonthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_PUBLISHER_MONTHLY,
      publisherYearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_PUBLISHER_YEARLY,
    } satisfies PaddlePriceIds,
  } as const;
}

// Price ID → 方案；空字串（env 未設定）一律略過，避免 '' 被當成合法 key
function priceIdPlanEntries(priceIds: PaddlePriceIds): Array<[string, PaidPlanKey]> {
  const entries: Array<[string | undefined, PaidPlanKey]> = [
    [priceIds.proMonthly, 'pro'],
    [priceIds.proYearly, 'pro'],
    [priceIds.teamMonthly, 'team'],
    [priceIds.teamYearly, 'team'],
    [priceIds.publisherMonthly, 'publisher'],
    [priceIds.publisherYearly, 'publisher'],
  ];
  return entries.filter((entry): entry is [string, PaidPlanKey] => !!entry[0]);
}

/** Paddle Price ID → subscription.plan 字串（pro / team / publisher / free） */
export function resolvePlanFromPriceId(
  priceId: string | null | undefined,
  priceIds: PaddlePriceIds,
): PaidPlanKey | 'free' {
  if (!priceId) {
    return 'free';
  }
  const hit = priceIdPlanEntries(priceIds).find(([id]) => id === priceId);
  return hit ? hit[1] : 'free';
}

/** checkout API 只接受 env 裡設定的 price，防止前端亂帶任意 price 下單 */
export function isAllowedPriceId(priceId: unknown, priceIds: PaddlePriceIds): boolean {
  if (typeof priceId !== 'string' || !priceId) {
    return false;
  }
  return priceIdPlanEntries(priceIds).some(([id]) => id === priceId);
}

/** 前端能否開 checkout：client token + 該方案 priceId 都要有 */
export function isPaddleClientReady(input: {
  clientToken: string | undefined;
  priceId: string | undefined;
}): boolean {
  return !!input.clientToken && !!input.priceId;
}

/** 回傳缺漏（未設或空字串）的 server env 名稱 */
export function getMissingPaddleServerEnv(
  env: Record<string, string | undefined>,
  keys: string[],
): string[] {
  return keys.filter(key => !env[key]);
}

/**
 * 定價頁 / navbar「定價」入口是否顯示。
 * 2026-11 正式收費後預設開啟；`NEXT_PUBLIC_PRICING_ENABLED=false` 為緊急回滾的 kill switch。
 * 呼叫端請傳 `process.env.NEXT_PUBLIC_PRICING_ENABLED`（字面量，client 端才會 inline）。
 */
export function isPricingEnabled(flag: string | undefined): boolean {
  return flag !== 'false';
}

// 視為「有效付費」的 Paddle 訂閱狀態（與 Plan.ts 一致）
export const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due']);

/**
 * 同一用戶可能有多筆訂閱（取消後重新訂閱、升級換方案）。
 * 規則：有效狀態優先；同層取 updatedAt 最新。全部無效時回最新那筆（呼叫端會判成 Free）。
 */
export function pickEffectiveSubscription<T extends { status: string; updatedAt: Date }>(
  rows: T[],
): T | null {
  if (rows.length === 0) {
    return null;
  }
  const byNewest = [...rows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return byNewest.find(row => ACTIVE_SUBSCRIPTION_STATUSES.has(row.status)) ?? byNewest[0]!;
}
