/**
 * 定價頁可見性 helper（公開首頁定價區塊 + /zh/pricing 共用）
 *
 * 規則：付費（PREMIUM/ENTERPRISE/PUBLISHER）OR 帳號內 quiz 數 ≥ 10 → 顯示完整三方案
 * 否則只顯示 Free。
 *
 * 拆「純函數 evaluateVisibility」+「async wrapper getPricingVisibility」
 * 對齊 fork.ts 模式，純邏輯獨立可測。
 */

import { auth } from '@clerk/nextjs/server';
import { count, eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { getUserPlanId } from '@/libs/Plan';
import { quizSchema } from '@/models/Schema';
import { PLAN_ID } from '@/utils/AppConfig';

export type PricingVisibilityReason = 'guest' | 'under' | 'reached' | 'paid';

export type PricingVisibility = {
  showPaidPlans: boolean;
  reason: PricingVisibilityReason;
};

// quiz 數門檻（對齊 AppConfig Free website: 10）
export const QUIZ_THRESHOLD = 10;

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
  quizCount: number;
}): PricingVisibility {
  if (!input.isAuthed) {
    return { showPaidPlans: false, reason: 'guest' };
  }
  if (PAID_PLAN_IDS.has(input.planId)) {
    return { showPaidPlans: true, reason: 'paid' };
  }
  if (input.quizCount >= QUIZ_THRESHOLD) {
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
    return evaluateVisibility({ isAuthed: false, planId: PLAN_ID.FREE, quizCount: 0 });
  }

  const planId = await getUserPlanId(userId);

  // 已是付費方案就不用算 quiz 數，直接 paid 分支
  if (PAID_PLAN_IDS.has(planId)) {
    return evaluateVisibility({ isAuthed: true, planId, quizCount: 0 });
  }

  // Free（含試用中，因為 trial 不算 paid 訂閱）→ 算 quiz 數
  const [row] = await db
    .select({ total: count() })
    .from(quizSchema)
    .where(eq(quizSchema.ownerId, userId));

  return evaluateVisibility({
    isAuthed: true,
    planId,
    quizCount: row?.total ?? 0,
  });
}
