// 試用 banner 顯示規則：試用剩 ≤ 7 天 / 到期 ≤ 7 天內一律提醒（不受定價門檻影響），
// 但未過定價門檻（pricingGate.ts）時不帶升級按鈕與方案文案

import { describe, expect, it } from 'vitest';

import { getTrialBannerState } from './trialBanner';

describe('getTrialBannerState', () => {
  it('試用中剩 8 天 → 不顯示', () => {
    expect(getTrialBannerState({ inTrial: true, daysLeft: 8, daysSinceEnd: 0, showPricing: true })).toBeNull();
  });

  it('試用中剩 7 天、未過門檻 → 顯示倒數，不帶升級', () => {
    expect(getTrialBannerState({ inTrial: true, daysLeft: 7, daysSinceEnd: 0, showPricing: false }))
      .toEqual({ kind: 'trial', urgent: false, showUpgrade: false });
  });

  it('試用中剩 3 天、已過門檻 → 顯示倒數（urgent）並帶升級', () => {
    expect(getTrialBannerState({ inTrial: true, daysLeft: 3, daysSinceEnd: 0, showPricing: true }))
      .toEqual({ kind: 'trial', urgent: true, showUpgrade: true });
  });

  it('到期第 7 天、未過門檻 → 顯示已結束，不帶升級', () => {
    expect(getTrialBannerState({ inTrial: false, daysLeft: 0, daysSinceEnd: 7, showPricing: false }))
      .toEqual({ kind: 'expired', urgent: false, showUpgrade: false });
  });

  it('到期第 8 天 → 不顯示', () => {
    expect(getTrialBannerState({ inTrial: false, daysLeft: 0, daysSinceEnd: 8, showPricing: true })).toBeNull();
  });
});
