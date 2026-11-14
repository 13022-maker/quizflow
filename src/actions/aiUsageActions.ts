'use server';

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { getUserPlanId, isProOrAbove } from '@/libs/Plan';
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
 * 當月用量 +1（不存在就建立）。
 * 用原子 SQL `count + 1`，避免同一老師併發出題時 read-modify-write 少算。
 */
async function incrementUsage(userId: string, yearMonth: string, existingId: number | undefined) {
  if (existingId !== undefined) {
    await db
      .update(aiUsageSchema)
      .set({ count: sql`${aiUsageSchema.count} + 1` })
      .where(eq(aiUsageSchema.id, existingId));
    return;
  }
  await db.insert(aiUsageSchema).values({ ownerId: userId, yearMonth, count: 1 });
}

/** 查當月用量紀錄（沒有則 undefined） */
async function findUsage(userId: string, yearMonth: string) {
  const [usage] = await db
    .select()
    .from(aiUsageSchema)
    .where(
      and(
        eq(aiUsageSchema.ownerId, userId),
        eq(aiUsageSchema.yearMonth, yearMonth),
      ),
    )
    .limit(1);
  return usage;
}

/**
 * 檢查 AI 出題 quota 並遞增使用次數
 * 回傳 { allowed: true } 或 { allowed: false, reason, remaining }
 *
 * 無上限方案（VIP / Pro / 30 天試用 / aiQuota >= 999）：一樣累加 ai_usage.count
 * 以便統計老師實際用量，但永遠允許、remaining 固定回 999（呼叫端只看 allowed / reason）。
 * Free：超過 aiQuota 擋下，不累加。
 */
export async function checkAndIncrementAiUsage(userId: string): Promise<
  | { allowed: true; remaining: number }
  | { allowed: false; reason: string; remaining: number }
> {
  const yearMonth = getCurrentYearMonth();

  // VIP 白名單不限制；試用中老師享 Pro 待遇（與 isProOrAbove 一致）
  const { isVipUser } = await import('@/libs/vip');
  let unlimited = (await isVipUser()) || (await isProOrAbove(userId));

  let quota = 999;
  if (!unlimited) {
    const planId = await getUserPlanId(userId);
    const plan = PricingPlanList[planId] ?? PricingPlanList[PLAN_ID.FREE]!;
    quota = plan.features.aiQuota;
    // Pro / Enterprise（999）視為無上限
    unlimited = quota >= 999;
  }

  const usage = await findUsage(userId, yearMonth);

  if (unlimited) {
    await incrementUsage(userId, yearMonth, usage?.id);
    return { allowed: true, remaining: 999 };
  }

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

  await incrementUsage(userId, yearMonth, usage?.id);

  return { allowed: true, remaining: remaining - 1 };
}

/**
 * 查詢當月剩餘次數（前端顯示用，不遞增）
 */
export async function getAiUsageRemaining(userId: string): Promise<{
  quota: number;
  used: number;
  remaining: number;
}> {
  // 試用中老師享 Pro 待遇（與 isProOrAbove 一致）
  if (await isProOrAbove(userId)) {
    return { quota: 999, used: 0, remaining: 999 };
  }

  const planId = await getUserPlanId(userId);
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
        eq(aiUsageSchema.ownerId, userId),
        eq(aiUsageSchema.yearMonth, yearMonth),
      ),
    )
    .limit(1);

  const used = usage?.count ?? 0;
  return { quota, used, remaining: Math.max(0, quota - used) };
}

/**
 * 從 Clerk auth 取得當前 userId，再查當月剩餘次數
 * 給 client component 用（它沒 userId 在手），內部複用 getAiUsageRemaining
 */
export async function getAiUsageRemainingForCurrentUser(): Promise<{
  quota: number;
  used: number;
  remaining: number;
} | null> {
  const { auth } = await import('@clerk/nextjs/server');
  const { userId } = await auth();
  if (!userId) {
    return null;
  }
  return getAiUsageRemaining(userId);
}
