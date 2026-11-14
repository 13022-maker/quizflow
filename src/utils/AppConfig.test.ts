import { describe, expect, it } from 'vitest';

import { PLAN_ID, PricingPlanList } from './AppConfig';

// 方案額度是對外承諾（定價頁 / FAQ / billing 頁都會引用），改動要有測試把關
describe('PricingPlanList', () => {
  it('Free 方案每月 AI 出題額度為 30 次', () => {
    expect(PricingPlanList[PLAN_ID.FREE]!.features.aiQuota).toBe(30);
  });

  it('Free 方案測驗數上限維持 10 份', () => {
    expect(PricingPlanList[PLAN_ID.FREE]!.features.website).toBe(10);
  });
});
