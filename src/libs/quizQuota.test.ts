import { describe, expect, it } from 'vitest';

import {
  DAILY_QUIZ_LIMIT_PRICING_PATH,
  evaluateDailyQuizQuota,
  getTaipeiDayStart,
} from './quizQuota';

describe('getTaipeiDayStart', () => {
  it('台北時間 11/15 22:53 → 當天 00:00（UTC 11/14 16:00）', () => {
    // 2026-11-15 22:53 +08:00 = 2026-11-15 14:53Z
    const now = new Date('2026-11-15T14:53:00Z');

    expect(getTaipeiDayStart(now).toISOString()).toBe('2026-11-14T16:00:00.000Z');
  });

  it('UTC 已過午夜但台北仍是前一天的早上 → 以台北日期為準', () => {
    // 2026-11-16 07:30 +08:00 = 2026-11-15 23:30Z
    const now = new Date('2026-11-15T23:30:00Z');

    expect(getTaipeiDayStart(now).toISOString()).toBe('2026-11-15T16:00:00.000Z');
  });

  it('台北午夜整點就是新的一天', () => {
    const now = new Date('2026-11-15T16:00:00Z'); // 11/16 00:00 台北

    expect(getTaipeiDayStart(now).toISOString()).toBe('2026-11-15T16:00:00.000Z');
  });
});

describe('evaluateDailyQuizQuota', () => {
  it('免費用戶今天建了 4 份 → 還能建，剩 1 份', () => {
    expect(evaluateDailyQuizQuota({ exempt: false, createdToday: 4, limit: 5 })).toEqual({
      limited: true,
      exceeded: false,
      used: 4,
      limit: 5,
      remaining: 1,
    });
  });

  it('免費用戶今天已建 5 份 → 第 6 份擋下', () => {
    expect(evaluateDailyQuizQuota({ exempt: false, createdToday: 5, limit: 5 })).toEqual({
      limited: true,
      exceeded: true,
      used: 5,
      limit: 5,
      remaining: 0,
    });
  });

  it('試用中 / Pro / VIP（exempt）不受每日上限限制', () => {
    expect(evaluateDailyQuizQuota({ exempt: true, createdToday: 50, limit: 5 })).toEqual({
      limited: false,
      exceeded: false,
      used: 50,
      limit: 5,
      remaining: Infinity,
    });
  });

  it('方案沒有每日上限（limit 未定義）→ 不限制', () => {
    expect(evaluateDailyQuizQuota({ exempt: false, createdToday: 50, limit: undefined }).exceeded).toBe(false);
  });
});

describe('DAILY_QUIZ_LIMIT_PRICING_PATH', () => {
  it('導向定價頁並帶 reason，讓定價頁顯示提示', () => {
    expect(DAILY_QUIZ_LIMIT_PRICING_PATH).toBe('/pricing?reason=daily_quiz_limit');
  });
});
