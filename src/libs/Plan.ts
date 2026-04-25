/**
 * 方案查詢工具
 *
 * 訂閱資料來自 Paddle，由 webhook 寫入 subscription 表（key = clerkUserId）。
 * QuizFlow 已移除 Clerk Organization，所有資源（quiz/quota/subscription）皆以 userId 為單位。
 *
 * 內部以 auth() 取得當下 userId 做查詢；getUserPlanId 的 _userId 參數目前未使用，
 * 保留作為未來 Team plan 擴展點（屆時可改為「用此 userId 查所屬 team 訂閱」）。
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
  if (plan === 'publisher') {
    return PLAN_ID.PUBLISHER;
  }
  return PLAN_ID.FREE;
}

/**
 * 取得目前登入用戶的方案 ID
 *
 * 純 user-level 訂閱：以 auth() 取得當下 userId，查 subscription 表決定方案。
 *
 * TODO（Team plan，等第一個學校採購時實作）：
 *   未來推 Team plan 需自建 team / team_membership 表（已無 Clerk Org 可借用），
 *   邏輯：先用 userId 查個人訂閱 → 若為 PREMIUM/ENTERPRISE 直接回傳；
 *   否則查該 user 所屬 team，若 team 有人持 'team' 有效訂閱 → 整 team 視為 ENTERPRISE。
 *
 * 參數 _userId 目前未使用（內部以 auth() 取得），保留作未來 Team plan 擴展點。
 */
export async function getUserPlanId(_userId: string): Promise<string> {
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
export async function isProOrAbove(userId: string): Promise<boolean> {
  const planId = await getUserPlanId(userId);
  if (planId === PLAN_ID.PREMIUM || planId === PLAN_ID.ENTERPRISE || planId === PLAN_ID.PUBLISHER) {
    return true;
  }

  if (!userId) {
    return false;
  }

  const trial = await ensureTrialRecord(userId);
  return trial.inTrial;
}
