/**
 * 定價／方案訊息顯示門檻（2026-11-25，取代原 navbar「實際出卷 > 57 份」規則）
 *
 * 新使用者先專心試用，不看到任何收費訊息；同時滿足以下兩個條件才出現：
 *   1. 實際出卷（已發佈 + 已關閉，草稿不算）超過 10 份
 *   2. 歷史最長連續使用天數（user_streak.longestStreak，建立測驗即算當日活動）超過 3 天
 * 用 longestStreak 而非 currentStreak：一旦達標就維持顯示，不會因為斷連又消失。
 * 已付費用戶一律顯示（要能看到方案、管理訂閱）。
 *
 * 管控範圍：dashboard navbar「定價」、TrialBanner、AiQuotaBanner、測驗列表與編輯器的「升級」提示、
 * 首頁定價區塊的付費方案卡。
 * 不管控：/pricing 頁本身與 footer 連結（Paddle domain approval 要求網站能找到定價頁），
 * 以及已達額度上限時的硬性阻擋訊息。
 */

export const PRICING_GATE_QUIZ_THRESHOLD = 10;
export const PRICING_GATE_STREAK_THRESHOLD = 3;

export type PricingGateInput = {
  isPaid: boolean;
  publishedQuizCount: number;
  longestStreak: number;
};

/** 純函數：兩個門檻都「超過」才顯示；付費用戶直接顯示 */
export function shouldShowPricingMessages(input: PricingGateInput): boolean {
  if (input.isPaid) {
    return true;
  }
  return input.publishedQuizCount > PRICING_GATE_QUIZ_THRESHOLD
    && input.longestStreak > PRICING_GATE_STREAK_THRESHOLD;
}
