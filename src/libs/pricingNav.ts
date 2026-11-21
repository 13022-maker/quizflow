/**
 * navbar「定價」入口顯示規則（2026-11）
 *
 * 新使用者／出卷量不多的老師先不顯示定價入口，避免一進來就看到收費、降低試用意願。
 * 「實際出卷」= 已發佈或已關閉的測驗（草稿不算）；超過門檻才顯示。
 *
 * 注意：只控制 navbar 入口。footer 連結與 /pricing 頁本身維持對所有人可見
 * （Paddle domain approval 要求網站上能找到定價頁）。
 */

export const PRICING_NAV_QUIZ_THRESHOLD = 57;

/** 純函數：實際出卷數「超過」門檻才顯示 */
export function shouldShowPricingNav(publishedQuizCount: number): boolean {
  return publishedQuizCount > PRICING_NAV_QUIZ_THRESHOLD;
}
