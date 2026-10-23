/**
 * aiUsageRefund.ts — AI 出題失敗時退還 quota（只給伺服器端 API Route 用）
 *
 * 背景：checkAndIncrementAiUsage 在 route 一開頭就先 +1（才能及早擋掉超額用戶），
 * 但之後的格式驗證、PDF 讀取、AI 呼叫、JSON 解析任何一步失敗都不會退，
 * 免費老師（每月 10 次）遇到一次加密 PDF 或 AI 過載就白白被扣次數。
 *
 * 刻意不放在 src/actions/aiUsageActions.ts：那是 'use server' 檔案，export 的函式
 * 會變成前端可直接呼叫的 Server Action，退還放那裡等於讓使用者自己無限退次數。
 */
import { and, eq, sql } from 'drizzle-orm';

import type { checkAndIncrementAiUsage } from '@/actions/aiUsageActions';
import { db } from '@/libs/DB';
import { aiUsageSchema } from '@/models/Schema';

type AllowedCharge = Extract<Awaited<ReturnType<typeof checkAndIncrementAiUsage>>, { allowed: true }>;

/** 把指定用戶、指定月份的計數 -1（最低 0）。yearMonth 必須用扣次當下回傳的值，避免跨月退錯列 */
export async function refundAiUsage(userId: string, yearMonth: string): Promise<void> {
  await db
    .update(aiUsageSchema)
    .set({ count: sql`GREATEST(${aiUsageSchema.count} - 1, 0)` })
    .where(and(eq(aiUsageSchema.ownerId, userId), eq(aiUsageSchema.yearMonth, yearMonth)));
}

/**
 * 執行 handler；回應是 4xx/5xx 或 handler 丟錯時，自動退還這次扣的次數。
 * 不限次數（Pro / VIP / 試用）的 charge.charged 為 false，不做任何事。
 * 退還本身失敗只記 log，不影響回給前端的原始錯誤。
 */
export async function withAiUsageRefund(
  userId: string,
  charge: AllowedCharge,
  handler: () => Promise<Response>,
): Promise<Response> {
  const refundIfCharged = async () => {
    if (!charge.charged) {
      return;
    }
    try {
      await refundAiUsage(userId, charge.yearMonth);
    } catch (err) {
      console.error('[aiUsageRefund] 退還 AI 次數失敗：', err);
    }
  };

  let response: Response;
  try {
    response = await handler();
  } catch (err) {
    await refundIfCharged();
    throw err;
  }
  if (response.status >= 400) {
    await refundIfCharged();
  }
  return response;
}
