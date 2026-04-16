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
import { ensureTrialRecord } from './trial';

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
 *
 * 目前實作：方案 1（純 user-level 訂閱）— 老師個人付費，自己受惠
 * 短期內 99% 用戶是 1 人 = 1 org，行為等同方案 3
 *
 * TODO（方案 3：Team org-fanout）— 等第一個學校採購（Team plan）時實作：
 *   1. 先用 userId 查當下用戶訂閱 → 若為 PREMIUM/ENTERPRISE 直接回傳
 *   2. 若無，再查 org 內所有 member 的 subscription，
 *      若有任一 member 持有 plan = 'team' 的有效訂閱 → 整 org 視為 ENTERPRISE
 *   3. 否則回傳 FREE
 *   做法：透過 clerkClient().organizations.getOrganizationMembershipList({ organizationId: orgId })
 *   取得所有 userId，再 IN 查 subscription
 *
 * 簽名保留 orgId 參數以便未來方案 3 升級不需修改 8 處呼叫。
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
 * 判斷順序：
 *   1. subscription 表有 active / trialing / past_due → Pro
 *   2. user_trial 表在試用期內（30 天） → Pro
 *      lazy init：新用戶首次呼叫時會自動建立試用紀錄
 *   3. 都沒有 → Free
 */
export async function isProOrAbove(orgId: string): Promise<boolean> {
  const planId = await getOrgPlanId(orgId);
  if (planId === PLAN_ID.PREMIUM || planId === PLAN_ID.ENTERPRISE) {
    return true;
  }

  const { userId } = await auth();
  if (!userId) {
    return false;
  }

  const trial = await ensureTrialRecord(userId);
  return trial.inTrial;
}
