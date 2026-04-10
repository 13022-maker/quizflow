'use server';

import { and, eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { getOrgPlanId } from '@/libs/Plan';
import { aiUsageSchema } from '@/models/Schema';
import { PLAN_ID, PricingPlanList } from '@/utils/AppConfig';

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
 * 檢查 AI 出題 quota 並遞增使用次數
 * 回傳 { allowed: true } 或 { allowed: false, reason, remaining }
 */
export async function checkAndIncrementAiUsage(orgId: string): Promise<
  | { allowed: true; remaining: number }
  | { allowed: false; reason: string; remaining: number }
> {
  // 取得方案
  const planId = await getOrgPlanId(orgId);
  const plan = PricingPlanList[planId] ?? PricingPlanList[PLAN_ID.FREE]!;
  const quota = plan.features.aiQuota;

  // Pro / Enterprise（999）直接放行
  if (quota >= 999) {
    return { allowed: true, remaining: 999 };
  }

  const yearMonth = getCurrentYearMonth();

  // 查詢當月使用記錄
  const [usage] = await db
    .select()
    .from(aiUsageSchema)
    .where(
      and(
        eq(aiUsageSchema.ownerId, orgId),
        eq(aiUsageSchema.yearMonth, yearMonth),
      ),
    )
    .limit(1);

  const currentCount = usage?.count ?? 0;
  const remaining = Math.max(0, quota - currentCount);

  // 超出額度
  if (currentCount >= quota) {
    return {
      allowed: false,
      reason: `本月 AI 出題次數已達上限（${quota} 次），升級 Pro 方案即可無限使用`,
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
      count: 1,
    });
  }

  return { allowed: true, remaining: remaining - 1 };
}

/**
 * 查詢當月剩餘次數（前端顯示用，不遞增）
 */
export async function getAiUsageRemaining(orgId: string): Promise<{
  quota: number;
  used: number;
  remaining: number;
}> {
  const planId = await getOrgPlanId(orgId);
  const plan = PricingPlanList[planId] ?? PricingPlanList[PLAN_ID.FREE]!;
  const quota = plan.features.aiQuota;

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
      ),
    )
    .limit(1);

  const used = usage?.count ?? 0;
  return { quota, used, remaining: Math.max(0, quota - used) };
}
