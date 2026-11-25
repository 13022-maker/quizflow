// 定價／方案訊息顯示門檻：實際出卷超過 10 份「且」連續使用超過 3 天（付費用戶一律顯示）

import { describe, expect, it } from 'vitest';

import {
  PRICING_GATE_QUIZ_THRESHOLD,
  PRICING_GATE_STREAK_THRESHOLD,
  shouldShowPricingMessages,
} from './pricingGate';

describe('shouldShowPricingMessages', () => {
  it('門檻為 10 份、3 天', () => {
    expect(PRICING_GATE_QUIZ_THRESHOLD).toBe(10);
    expect(PRICING_GATE_STREAK_THRESHOLD).toBe(3);
  });

  it('新使用者（0 份、0 天）→ 不顯示', () => {
    expect(shouldShowPricingMessages({ isPaid: false, publishedQuizCount: 0, longestStreak: 0 })).toBe(false);
  });

  it('剛好 10 份（沒有超過）+ 連續 5 天 → 不顯示', () => {
    expect(shouldShowPricingMessages({ isPaid: false, publishedQuizCount: 10, longestStreak: 5 })).toBe(false);
  });

  it('11 份 + 剛好連續 3 天（沒有超過）→ 不顯示', () => {
    expect(shouldShowPricingMessages({ isPaid: false, publishedQuizCount: 11, longestStreak: 3 })).toBe(false);
  });

  it('11 份 + 連續 4 天 → 顯示', () => {
    expect(shouldShowPricingMessages({ isPaid: false, publishedQuizCount: 11, longestStreak: 4 })).toBe(true);
  });

  it('出卷很多但從沒連續超過 3 天 → 不顯示', () => {
    expect(shouldShowPricingMessages({ isPaid: false, publishedQuizCount: 80, longestStreak: 2 })).toBe(false);
  });

  it('付費用戶不論出卷數 → 顯示（要能管理訂閱）', () => {
    expect(shouldShowPricingMessages({ isPaid: true, publishedQuizCount: 0, longestStreak: 0 })).toBe(true);
  });
});
