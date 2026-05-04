// 4 分支純函數單測（對齊 src/libs/fork.test.ts 不接 DB 的風格）

import { describe, expect, it } from 'vitest';

import { PLAN_ID } from '@/utils/AppConfig';

import { evaluateVisibility } from './PricingVisibility';

describe('evaluateVisibility', () => {
  it('未登入訪客 → guest 分支，不顯示付費卡', () => {
    const result = evaluateVisibility({
      isAuthed: false,
      planId: PLAN_ID.FREE,
      quizCount: 0,
    });

    expect(result).toEqual({ showPaidPlans: false, reason: 'guest' });
  });

  it('已登入 PREMIUM → paid 分支，顯示完整方案', () => {
    const result = evaluateVisibility({
      isAuthed: true,
      planId: PLAN_ID.PREMIUM,
      quizCount: 0,
    });

    expect(result).toEqual({ showPaidPlans: true, reason: 'paid' });
  });

  it('已登入 ENTERPRISE → paid 分支，顯示完整方案', () => {
    const result = evaluateVisibility({
      isAuthed: true,
      planId: PLAN_ID.ENTERPRISE,
      quizCount: 0,
    });

    expect(result).toEqual({ showPaidPlans: true, reason: 'paid' });
  });

  it('已登入 PUBLISHER → paid 分支，顯示完整方案', () => {
    const result = evaluateVisibility({
      isAuthed: true,
      planId: PLAN_ID.PUBLISHER,
      quizCount: 0,
    });

    expect(result).toEqual({ showPaidPlans: true, reason: 'paid' });
  });

  it('已登入 FREE + quiz 數 = 10（剛達門檻）→ reached 分支', () => {
    const result = evaluateVisibility({
      isAuthed: true,
      planId: PLAN_ID.FREE,
      quizCount: 10,
    });

    expect(result).toEqual({ showPaidPlans: true, reason: 'reached' });
  });

  it('已登入 FREE + quiz 數 = 11（超過門檻）→ reached 分支', () => {
    const result = evaluateVisibility({
      isAuthed: true,
      planId: PLAN_ID.FREE,
      quizCount: 11,
    });

    expect(result).toEqual({ showPaidPlans: true, reason: 'reached' });
  });

  it('已登入 FREE + quiz 數 = 9（差一份）→ under 分支', () => {
    const result = evaluateVisibility({
      isAuthed: true,
      planId: PLAN_ID.FREE,
      quizCount: 9,
    });

    expect(result).toEqual({ showPaidPlans: false, reason: 'under' });
  });

  it('已登入 FREE + quiz 數 = 0 → under 分支', () => {
    const result = evaluateVisibility({
      isAuthed: true,
      planId: PLAN_ID.FREE,
      quizCount: 0,
    });

    expect(result).toEqual({ showPaidPlans: false, reason: 'under' });
  });
});
