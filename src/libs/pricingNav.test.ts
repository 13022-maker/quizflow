// navbar「定價」入口顯示規則：實際出卷（已發佈／已關閉）超過 57 份才顯示

import { describe, expect, it } from 'vitest';

import { PRICING_NAV_QUIZ_THRESHOLD, shouldShowPricingNav } from './pricingNav';

describe('shouldShowPricingNav', () => {
  it('門檻為 57 份', () => {
    expect(PRICING_NAV_QUIZ_THRESHOLD).toBe(57);
  });

  it('新使用者（0 份）→ 不顯示', () => {
    expect(shouldShowPricingNav(0)).toBe(false);
  });

  it('剛好 57 份（沒有超過）→ 不顯示', () => {
    expect(shouldShowPricingNav(57)).toBe(false);
  });

  it('58 份 → 顯示', () => {
    expect(shouldShowPricingNav(58)).toBe(true);
  });
});
