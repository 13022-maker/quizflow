'use server';

import { and, eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { getOrgPlanId } from '@/libs/Plan';
import { aiUsageSchema } from '@/models/Schema';
import { PLAN_ID, PricingPlanList } from '@/utils/AppConfig';

export type AiFeature = 'question_generation' | 'essay_grading';

/**
 * 取得當月 yearMonth 字串，格式：'2026-04'
 */
function getCurrentYearMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * 取得方案的該 feature 配額上限
 */
function getPlanQuota(planId: string, feature: AiFeature): number {
  const plan = PricingPlanList[planId] ?? PricingPlanList[PLAN_ID.FREE]!;
  if (feature === 'essay_grading') {
    return plan.features.essayGradingQuota;
  }
  return plan.features.aiQuota;
}

/**
 * 檢查 AI quota 並遞增使用次數
 * feature:
 *   - 'question_generation'（預設）：AI 出題
 *   - 'essay_grading'：申論題批改（500 份/月，Free 為 0）
 * 回傳 { allowed: true } 或 { allowed: false, reason, remaining }
 */
export async function checkAndIncrementAiUsage(
  orgId: string,
  feature: AiFeature = 'question_generation',
): Promise<
  | { allowed: true; remaining: number }
  | { allowed: false; reason: string; remaining: number }
  > {
  // VIP 白名單不限制
  const { isVipUser } = await import('@/libs/vip');
  if (await isVipUser()) {
    return { allowed: true, remaining: 999 };
  }

  // 2026 年 4 月試用期：只開放出題功能不限（批改仍走正式配額）
  const now = new Date();
  if (
    feature === 'question_generation'
    && now.getFullYear() === 2026
    && now.getMonth() === 3
  ) {
    return { allowed: true, remaining: 999 };
  }

  // 取得方案 + 配額
  const planId = await getOrgPlanId(orgId);
  const quota = getPlanQuota(planId, feature);

  // 999 代表無限制，直接放行
  if (quota >= 999) {
    return { allowed: true, remaining: 999 };
  }

  // 免費方案且該 feature 配額為 0（例如 essay_grading Pro 限定）
  if (quota === 0) {
    return {
      allowed: false,
      reason: feature === 'essay_grading'
        ? 'AI 批改為 Pro 方案專屬功能，升級即可每月批改 500 份作文'
        : 'AI 出題為 Pro 方案專屬功能，升級即可無限使用',
      remaining: 0,
    };
  }

  const yearMonth = getCurrentYearMonth();

  // 查詢當月使用記錄（依 feature 區分）
  const [usage] = await db
    .select()
    .from(aiUsageSchema)
    .where(
      and(
        eq(aiUsageSchema.ownerId, orgId),
        eq(aiUsageSchema.yearMonth, yearMonth),
        eq(aiUsageSchema.feature, feature),
      ),
    )
    .limit(1);

  const currentCount = usage?.count ?? 0;
  const remaining = Math.max(0, quota - currentCount);

  // 超出額度
  if (currentCount >= quota) {
    return {
      allowed: false,
      reason: feature === 'essay_grading'
        ? `本月 AI 批改次數已達上限（${quota} 份），下月 1 日自動重置`
        : `本月 AI 出題次數已達上限（${quota} 次），升級 Pro 方案即可無限使用`,
      remaining: 0,
    };
  }

  // 遞增計數
  if (usage) {
    await db
      .update(aiUsageSchema)
      .set({ count: currentCount + 1 })
      .where(eq(aiUsageSchema.id, usage.id));
  } else {
    await db.insert(aiUsageSchema).values({
      ownerId: orgId,
      yearMonth,
      feature,
      count: 1,
    });
  }

  return { allowed: true, remaining: remaining - 1 };
}

/**
 * 查詢某 feature 當月剩餘次數（前端顯示用，不遞增）
 */
export async function getAiUsageRemaining(
  orgId: string,
  feature: AiFeature = 'question_generation',
): Promise<{
    quota: number;
    used: number;
    remaining: number;
  }> {
  const planId = await getOrgPlanId(orgId);
  const quota = getPlanQuota(planId, feature);

  if (quota >= 999) {
    return { quota: 999, used: 0, remaining: 999 };
  }

  const yearMonth = getCurrentYearMonth();
  const [usage] = await db
    .select()
    .from(aiUsageSchema)
    .where(
      and(
        eq(aiUsageSchema.ownerId, orgId),
        eq(aiUsageSchema.yearMonth, yearMonth),
        eq(aiUsageSchema.feature, feature),
      ),
    )
    .limit(1);

  const used = usage?.count ?? 0;
  return { quota, used, remaining: Math.max(0, quota - used) };
}
