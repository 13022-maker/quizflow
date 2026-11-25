// 4 分支純函數單測（對齊 src/libs/fork.test.ts 不接 DB 的風格）

import { describe, expect, it } from 'vitest';

import { PLAN_ID } from '@/utils/AppConfig';

import { evaluateVisibility } from './PricingVisibility';

describe('evaluateVisibility', () => {
  it('未登入訪客 → guest 分支，不顯示付費卡', () => {
    const result = evaluateVisibility({
      isAuthed: false,
      planId: PLAN_ID.FREE,
      publishedQuizCount: 0,
      longestStreak: 0,
    });

    expect(result).toEqual({ showPaidPlans: false, reason: 'guest' });
  });

  it('已登入 PREMIUM → paid 分支，顯示完整方案', () => {
    const result = evaluateVisibility({
      isAuthed: true,
      planId: PLAN_ID.PREMIUM,
      publishedQuizCount: 0,
      longestStreak: 0,
    });

    expect(result).toEqual({ showPaidPlans: true, reason: 'paid' });
  });

  it('已登入 ENTERPRISE → paid 分支，顯示完整方案', () => {
    const result = evaluateVisibility({
      isAuthed: true,
      planId: PLAN_ID.ENTERPRISE,
      publishedQuizCount: 0,
      longestStreak: 0,
    });

    expect(result).toEqual({ showPaidPlans: true, reason: 'paid' });
  });

  it('已登入 PUBLISHER → paid 分支，顯示完整方案', () => {
    const result = evaluateVisibility({
      isAuthed: true,
      planId: PLAN_ID.PUBLISHER,
      publishedQuizCount: 0,
      longestStreak: 0,
    });

    expect(result).toEqual({ showPaidPlans: true, reason: 'paid' });
  });

  it('已登入 FREE + 出卷 11 份 + 連續 4 天 → reached 分支', () => {
    const result = evaluateVisibility({
      isAuthed: true,
      planId: PLAN_ID.FREE,
      publishedQuizCount: 11,
      longestStreak: 4,
    });

    expect(result).toEqual({ showPaidPlans: true, reason: 'reached' });
  });

  it('已登入 FREE + 剛好出卷 10 份（沒超過）+ 連續 4 天 → under 分支', () => {
    const result = evaluateVisibility({
      isAuthed: true,
      planId: PLAN_ID.FREE,
      publishedQuizCount: 10,
      longestStreak: 4,
    });

    expect(result).toEqual({ showPaidPlans: false, reason: 'under' });
  });

  it('已登入 FREE + 出卷 30 份但連續只有 3 天 → under 分支', () => {
    const result = evaluateVisibility({
      isAuthed: true,
      planId: PLAN_ID.FREE,
      publishedQuizCount: 30,
      longestStreak: 3,
    });

    expect(result).toEqual({ showPaidPlans: false, reason: 'under' });
  });

  it('已登入 FREE + 0 份 → under 分支', () => {
    const result = evaluateVisibility({
      isAuthed: true,
      planId: PLAN_ID.FREE,
      publishedQuizCount: 0,
      longestStreak: 0,
    });

    expect(result).toEqual({ showPaidPlans: false, reason: 'under' });
  });
});
