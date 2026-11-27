/**
 * TrialBanner 的顯示規則（純函數）
 *
 * 試用到期提醒不受定價訊息門檻（pricingGate.ts）限制：試用剩 ≤ 7 天、或到期後 7 天內都會提醒，
 * 避免新老師不知不覺從 Pro 掉回 Free。
 * 但未過門檻時只做提醒，不帶「升級 Pro」按鈕與方案文案。
 */

const SHOW_WINDOW_DAYS = 7;
const URGENT_DAYS = 3;

export type TrialBannerInput = {
  inTrial: boolean;
  daysLeft: number;
  daysSinceEnd: number;
  showPricing: boolean;
};

export type TrialBannerState = {
  kind: 'trial' | 'expired';
  urgent: boolean;
  showUpgrade: boolean;
};

export function getTrialBannerState(input: TrialBannerInput): TrialBannerState | null {
  if (input.inTrial) {
    if (input.daysLeft > SHOW_WINDOW_DAYS) {
      return null;
    }
    return { kind: 'trial', urgent: input.daysLeft <= URGENT_DAYS, showUpgrade: input.showPricing };
  }

  // 已到期：限期 7 天顯示，之後讓 AiQuotaBanner 接手（AiQuotaBanner 仍受定價門檻管控）
  if (input.daysSinceEnd > SHOW_WINDOW_DAYS) {
    return null;
  }
  return { kind: 'expired', urgent: false, showUpgrade: input.showPricing };
}
