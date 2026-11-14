// 方案價格守門測試：數字必須和 Paddle production 4 個 Price（Pro/Team × 月/年）的金額一致。
// 改價格時請先改 Paddle Dashboard 的 Price，再同步這裡與 PricingSection，否則結帳金額會和網站顯示不同。
import { describe, expect, it } from 'vitest';

import { PLAN_ID, PricingPlanList } from './AppConfig';

describe('PricingPlanList 價格（NT$）', () => {
  it('Pro 老師：月 299 / 年 2,490', () => {
    expect(PricingPlanList[PLAN_ID.PREMIUM]!.price).toBe(299);
    expect(PricingPlanList[PLAN_ID.PREMIUM]!.yearlyPrice).toBe(2490);
  });

  it('學校方案（Team）：月 1,990 / 年 16,990', () => {
    expect(PricingPlanList[PLAN_ID.ENTERPRISE]!.price).toBe(1990);
    expect(PricingPlanList[PLAN_ID.ENTERPRISE]!.yearlyPrice).toBe(16990);
  });

  it('Free：0 元', () => {
    expect(PricingPlanList[PLAN_ID.FREE]!.price).toBe(0);
    expect(PricingPlanList[PLAN_ID.FREE]!.yearlyPrice).toBe(0);
  });
});
