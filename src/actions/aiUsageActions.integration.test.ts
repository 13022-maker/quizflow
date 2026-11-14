// checkAndIncrementAiUsage 整合測試（in-memory PGlite，走真實 migration）
//
// 背景：原本 Pro / 30 天試用 / VIP 直接 early return、不寫 ai_usage，
// 導致拿不到老師實際用量。改為「照樣累加 count、但永遠允許」；Free 行為不變（超過額度擋）。
// 期望值全部手算（Free aiQuota = 30，見 src/utils/AppConfig.ts）。
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/libs/DB';
import { aiUsageSchema } from '@/models/Schema';

import { checkAndIncrementAiUsage } from './aiUsageActions';

const state = vi.hoisted(() => ({ isPro: false, isVip: false }));

vi.mock('@/libs/Plan', () => ({
  isProOrAbove: async () => state.isPro,
  getUserPlanId: async () => 'free',
}));

vi.mock('@/libs/vip', () => ({
  isVipUser: async () => state.isVip,
}));

let seq = 0;
function nextUser() {
  seq += 1;
  return `user_ai_usage_test_${seq}`;
}

function currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function usageCount(userId: string): Promise<number | undefined> {
  const [row] = await db
    .select()
    .from(aiUsageSchema)
    .where(and(eq(aiUsageSchema.ownerId, userId), eq(aiUsageSchema.yearMonth, currentYearMonth())));
  return row?.count;
}

describe('checkAndIncrementAiUsage', () => {
  beforeEach(() => {
    state.isPro = false;
    state.isVip = false;
  });

  it('試用 / Pro 帳號：第一次呼叫寫入 count = 1 且允許', async () => {
    state.isPro = true;
    const userId = nextUser();

    const res = await checkAndIncrementAiUsage(userId);

    expect(res).toEqual({ allowed: true, remaining: 999 });
    expect(await usageCount(userId)).toBe(1);
  });

  it('試用 / Pro 帳號：超過 Free 額度（第 31、32 次）仍允許，count 持續累加', async () => {
    state.isPro = true;
    const userId = nextUser();
    await db.insert(aiUsageSchema).values({ ownerId: userId, yearMonth: currentYearMonth(), count: 30 });

    const r1 = await checkAndIncrementAiUsage(userId);
    const r2 = await checkAndIncrementAiUsage(userId);

    expect(r1).toEqual({ allowed: true, remaining: 999 });
    expect(r2).toEqual({ allowed: true, remaining: 999 });
    // 30 + 1 + 1 = 32
    expect(await usageCount(userId)).toBe(32);
  });

  it('VIP 白名單：同樣累加 count 且允許', async () => {
    state.isVip = true;
    const userId = nextUser();

    const res = await checkAndIncrementAiUsage(userId);

    expect(res).toEqual({ allowed: true, remaining: 999 });
    expect(await usageCount(userId)).toBe(1);
  });

  it('Free 帳號：額度內允許，remaining = 30 - 用過次數', async () => {
    const userId = nextUser();
    await db.insert(aiUsageSchema).values({ ownerId: userId, yearMonth: currentYearMonth(), count: 3 });

    const res = await checkAndIncrementAiUsage(userId);

    // 呼叫前已用 3 次 → 這次是第 4 次 → 剩 30 - 4 = 26
    expect(res).toEqual({ allowed: true, remaining: 26 });
    expect(await usageCount(userId)).toBe(4);
  });

  it('Free 帳號：已用滿 30 次 → 擋下且 count 不再增加', async () => {
    const userId = nextUser();
    await db.insert(aiUsageSchema).values({ ownerId: userId, yearMonth: currentYearMonth(), count: 30 });

    const res = await checkAndIncrementAiUsage(userId);

    expect(res).toEqual({
      allowed: false,
      reason: '本月 AI 出題次數已達上限（30 次），升級 Pro 方案即可無限使用',
      remaining: 0,
    });
    expect(await usageCount(userId)).toBe(30);
  });
});
