/**
 * 定價頁可見性 helper（公開首頁定價區塊 + /zh/pricing 共用）
 *
 * 規則：付費（PREMIUM/ENTERPRISE/PUBLISHER）OR 過定價訊息門檻（實際出卷 > 10 份且連續使用 > 3 天，
 * 見 pricingGate.ts）→ 顯示完整三方案；否則只顯示 Free。
 *
 * 拆「純函數 evaluateVisibility」+「async wrapper getPricingVisibility」
 * 對齊 fork.ts 模式，純邏輯獨立可測。
 */

import { auth } from '@clerk/nextjs/server';

import { getUserPlanId } from '@/libs/Plan';
import { shouldShowPricingMessages } from '@/libs/pricingGate';
import { countPublishedQuizzes } from '@/libs/pricingGateQuery';
import { getStreak } from '@/libs/streak';
import { PLAN_ID } from '@/utils/AppConfig';

export type PricingVisibilityReason = 'guest' | 'under' | 'reached' | 'paid';

export type PricingVisibility = {
  showPaidPlans: boolean;
  reason: PricingVisibilityReason;
};

const PAID_PLAN_IDS = new Set<string>([
  PLAN_ID.PREMIUM,
  PLAN_ID.ENTERPRISE,
  PLAN_ID.PUBLISHER,
]);

/**
 * 純函數：依輸入決定 showPaidPlans
 * 不接任何外部依賴，可獨立測試
 */
export function evaluateVisibility(input: {
  isAuthed: boolean;
  planId: string;
  publishedQuizCount: number;
  longestStreak: number;
}): PricingVisibility {
  if (!input.isAuthed) {
    return { showPaidPlans: false, reason: 'guest' };
  }
  if (PAID_PLAN_IDS.has(input.planId)) {
    return { showPaidPlans: true, reason: 'paid' };
  }
  if (shouldShowPricingMessages({
    isPaid: false,
    publishedQuizCount: input.publishedQuizCount,
    longestStreak: input.longestStreak,
  })) {
    return { showPaidPlans: true, reason: 'reached' };
  }
  return { showPaidPlans: false, reason: 'under' };
}

/**
 * server helper：拉 auth + planId + quiz count，呼叫 evaluateVisibility
 *
 * 注意：呼叫端的 server component 需配合 noStore() 或 dynamic = 'force-dynamic'
 * 避免 ISR 把單一用戶結果靜態快取給所有訪客。
 */
export async function getPricingVisibility(): Promise<PricingVisibility> {
  const { userId } = await auth();

  if (!userId) {
    return evaluateVisibility({ isAuthed: false, planId: PLAN_ID.FREE, publishedQuizCount: 0, longestStreak: 0 });
  }

  const planId = await getUserPlanId(userId);

  // 已是付費方案就不用算出卷數，直接 paid 分支
  if (PAID_PLAN_IDS.has(planId)) {
    return evaluateVisibility({ isAuthed: true, planId, publishedQuizCount: 0, longestStreak: 0 });
  }

  // Free（含試用中，因為 trial 不算 paid 訂閱）→ 算實際出卷數 + 最長連續使用天數
  const [publishedQuizCount, streak] = await Promise.all([
    countPublishedQuizzes(userId),
    getStreak(userId),
  ]);

  return evaluateVisibility({
    isAuthed: true,
    planId,
    publishedQuizCount,
    longestStreak: streak.longestStreak,
  });
}
