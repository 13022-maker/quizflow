/**
 * 21 天 Pro 試用機制
 *
 * 策略：lazy init — 新用戶首次需要 Pro 資格時才建立試用紀錄，避免額外 Clerk webhook
 * 試用期結束自動降級為免費（無付費訂閱時）
 */

import { eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { userTrialSchema } from '@/models/Schema';

const TRIAL_DAYS = 21;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type TrialStatus = {
  inTrial: boolean; // 是否在試用期內
  daysLeft: number; // 剩餘天數（過期為 0）
  endsAt: Date | null; // 試用結束時間
  startedAt: Date | null; // 試用起始時間
};

// 首次取得試用狀態時自動建立紀錄；已存在就回傳現有
export async function ensureTrialRecord(clerkUserId: string): Promise<TrialStatus> {
  const [existing] = await db
    .select()
    .from(userTrialSchema)
    .where(eq(userTrialSchema.clerkUserId, clerkUserId))
    .limit(1);

  if (existing) {
    return computeStatus(existing.startedAt, existing.endsAt);
  }

  // 建立新試用紀錄：21 天後到期
  const now = new Date();
  const endsAt = new Date(now.getTime() + TRIAL_DAYS * MS_PER_DAY);

  await db.insert(userTrialSchema).values({
    clerkUserId,
    startedAt: now,
    endsAt,
  });

  return computeStatus(now, endsAt);
}

// 純查詢版本，不會建立新紀錄（給 Dashboard 顯示用）
export async function getTrialStatus(clerkUserId: string): Promise<TrialStatus | null> {
  const [existing] = await db
    .select()
    .from(userTrialSchema)
    .where(eq(userTrialSchema.clerkUserId, clerkUserId))
    .limit(1);

  if (!existing) {
    return null;
  }

  return computeStatus(existing.startedAt, existing.endsAt);
}

function computeStatus(startedAt: Date, endsAt: Date): TrialStatus {
  const now = Date.now();
  const diffMs = endsAt.getTime() - now;
  const inTrial = diffMs > 0;
  const daysLeft = inTrial ? Math.ceil(diffMs / MS_PER_DAY) : 0;
  return { inTrial, daysLeft, endsAt, startedAt };
}
