/**
 * 每日建立測驗額度的 DB 查詢層（純邏輯在 quizQuota.ts）
 */

import { and, count, eq, gte, ne } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { getUserPlanId, isProOrAbove } from '@/libs/Plan';
import { type DailyQuizQuota, evaluateDailyQuizQuota, getTaipeiDayStart } from '@/libs/quizQuota';
import { quizSchema } from '@/models/Schema';
import { PricingPlanList } from '@/utils/AppConfig';

/**
 * server helper：判斷 VIP / Pro / 試用 → 查今日建立數 → evaluateDailyQuizQuota
 * live_snapshot 是直播自動複製的快照，不算老師主動建立的測驗
 */
export async function getDailyQuizQuota(userId: string): Promise<DailyQuizQuota> {
  const { isVipUser } = await import('@/libs/vip');
  // isProOrAbove 已包含試用中（30 天 Pro 試用）
  const exempt = (await isVipUser()) || (await isProOrAbove(userId));

  const planId = await getUserPlanId(userId);
  const limit = PricingPlanList[planId]?.features.dailyQuizLimit;

  if (exempt || limit === undefined) {
    return evaluateDailyQuizQuota({ exempt: true, createdToday: 0, limit });
  }

  const [row] = await db
    .select({ total: count() })
    .from(quizSchema)
    .where(and(
      eq(quizSchema.ownerId, userId),
      ne(quizSchema.quizMode, 'live_snapshot'),
      gte(quizSchema.createdAt, getTaipeiDayStart(new Date())),
    ));

  return evaluateDailyQuizQuota({ exempt: false, createdToday: row?.total ?? 0, limit });
}
