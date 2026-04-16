/**
 * 方案查詢工具
 *
 * 訂閱資料現在來自 Paddle，由 webhook 寫入 subscription 表（key = clerkUserId）。
 * 注意：QuizFlow 採用 Clerk Organization 作為多租戶 tenant（quiz/quota 以 orgId 為單位），
 * 但訂閱本身是「個人」付費，因此查詢時需要透過 auth() 取得當下 userId。
 *
 * 函式簽名（getOrgPlanId(orgId)）保留向後相容，呼叫者不需要改。
 */

import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';

import { subscriptionSchema } from '@/models/Schema';
import { PLAN_ID } from '@/utils/AppConfig';

import { db } from './DB';

// 視為「有效付費」的 Paddle 訂閱狀態
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

// subscription.plan 字串 ↔ PLAN_ID
function mapPlan(plan: string): string {
  if (plan === 'team') {
    return PLAN_ID.ENTERPRISE;
  }
  if (plan === 'pro') {
    return PLAN_ID.PREMIUM;
  }
  return PLAN_ID.FREE;
}

/**
 * 取得目前登入用戶的方案 ID
 * 簽名保留 orgId 參數以維持向後相容（暫不使用，僅作未來 org-level 分潤識別）
 */
export async function getOrgPlanId(_orgId: string): Promise<string> {
  const { userId } = await auth();
  if (!userId) {
    return PLAN_ID.FREE;
  }

  const [sub] = await db
    .select({
      plan: subscriptionSchema.plan,
      status: subscriptionSchema.status,
    })
    .from(subscriptionSchema)
    .where(eq(subscriptionSchema.clerkUserId, userId))
    .limit(1);

  if (!sub || !ACTIVE_STATUSES.has(sub.status)) {
    return PLAN_ID.FREE;
  }

  return mapPlan(sub.plan);
}

/**
 * 是否為 Pro 或以上方案（用於 AI 出題、進階功能解鎖等地方）
 *
 * 測試期延長至 2026-06-30：所有登入用戶視為 Pro。
 * 此期限到期後（或 30 天試用機制上線後）刪除這段 hardcode。
 * TODO: 整合 30 天試用機制（待實作 trial schema + 倒數）
 */
export async function isProOrAbove(orgId: string): Promise<boolean> {
  // 測試期 hardcode：2026-06-30 23:59:59 (UTC) 前所有用戶視為 Pro
  // 用 UTC ms timestamp 避免時區誤判
  const TEST_PERIOD_END = Date.UTC(2026, 5, 30, 23, 59, 59); // 月份 0-indexed: 5 = 6 月
  if (Date.now() < TEST_PERIOD_END) {
    return true;
  }

  const planId = await getOrgPlanId(orgId);
  return planId === PLAN_ID.PREMIUM || planId === PLAN_ID.ENTERPRISE;
}
