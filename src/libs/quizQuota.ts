/**
 * 免費方案「每日建立測驗」額度
 *
 * 規則（2026-11）：新帳號 30 天 Pro 試用期間不限；試用結束後的 Free 用戶
 * 每天（台北時間 00:00 起算）最多建立 dailyQuizLimit 份測驗，第 6 份起導向定價頁。
 * VIP / Pro / 學校 / 書商方案不受限制。
 *
 * 純函數放這裡（可獨立測試）；查 DB 的 getDailyQuizQuota 在 quizQuota-dao.ts（對齊 fork.ts / fork-dao.ts）。
 */

// 超過每日上限時導向的定價頁（定價頁依 reason 顯示提示）
export const DAILY_QUIZ_LIMIT_PRICING_PATH = '/pricing?reason=daily_quiz_limit';

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000; // 台灣無日光節約，固定 +08:00
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type DailyQuizQuota = {
  limited: boolean; // 是否受每日上限限制
  exceeded: boolean; // 今天是否已達上限（不能再建）
  used: number; // 今天已建立份數
  limit: number | undefined; // 每日上限
  remaining: number; // 今天剩餘份數（不受限為 Infinity）
};

// 純函數：台北時間「今天 00:00」對應的 UTC 時間點
export function getTaipeiDayStart(now: Date): Date {
  const taipeiMs = now.getTime() + TAIPEI_OFFSET_MS;
  const dayStartTaipeiMs = Math.floor(taipeiMs / MS_PER_DAY) * MS_PER_DAY;
  return new Date(dayStartTaipeiMs - TAIPEI_OFFSET_MS);
}

// 純函數：依今日已建立數與上限判斷額度
export function evaluateDailyQuizQuota(input: {
  exempt: boolean;
  createdToday: number;
  limit: number | undefined;
}): DailyQuizQuota {
  const { exempt, createdToday, limit } = input;
  if (exempt || limit === undefined) {
    return { limited: false, exceeded: false, used: createdToday, limit, remaining: Infinity };
  }
  return {
    limited: true,
    exceeded: createdToday >= limit,
    used: createdToday,
    limit,
    remaining: Math.max(0, limit - createdToday),
  };
}
