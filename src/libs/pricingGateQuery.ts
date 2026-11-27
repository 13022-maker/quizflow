// 定價訊息門檻用的 DB 查詢（純規則在 pricingGate.ts，拆開讓單測不載入 DB / env）

import { and, count, eq, inArray } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { getUserPlanId } from '@/libs/Plan';
import { shouldShowPricingMessages } from '@/libs/pricingGate';
import { getStreak } from '@/libs/streak';
import { quizSchema } from '@/models/Schema';
import { PLAN_ID } from '@/utils/AppConfig';

const PAID_PLAN_IDS = new Set<string>([
  PLAN_ID.PREMIUM,
  PLAN_ID.ENTERPRISE,
  PLAN_ID.PUBLISHER,
]);

/** 計算該老師實際出卷數（published + closed，草稿不算） */
export async function countPublishedQuizzes(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(quizSchema)
    .where(and(
      eq(quizSchema.ownerId, userId),
      inArray(quizSchema.status, ['published', 'closed']),
    ));

  return row?.total ?? 0;
}

/**
 * 該老師現在能否看到定價／方案／升級訊息。
 * 付費用戶直接 true（只查訂閱）；其餘查實際出卷數 + 最長連續使用天數（兩個小查詢並行）。
 */
export async function canShowPricingMessages(userId: string): Promise<boolean> {
  const planId = await getUserPlanId(userId);
  if (PAID_PLAN_IDS.has(planId)) {
    return true;
  }

  const [publishedQuizCount, streak] = await Promise.all([
    countPublishedQuizzes(userId),
    getStreak(userId),
  ]);

  return shouldShowPricingMessages({
    isPaid: false,
    publishedQuizCount,
    longestStreak: streak.longestStreak,
  });
}
