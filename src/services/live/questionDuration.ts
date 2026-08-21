// Live Mode 計時邏輯：算出某題實際該倒數幾秒。
// 聽力題要先播完音檔才能作答，固定的 game.questionDuration 不夠用，
// 這裡把音檔長度也算進去，讓「聽 + 答」都在同一個倒數視窗內做得完。

// 聽力題偵測不到音檔長度時的寬限秒數（上傳中斷、舊題目、瀏覽器不支援皆走這條）
export const LISTENING_FALLBACK_SEC = 15;

/**
 * 算出某題在 Live Mode 實際的作答時長。
 * 聽力題 = 老師設定的基礎時長 + 音檔長度（沒偵測到就 +15s 寬限）；
 * 其他題型不受影響，直接回傳基礎時長。
 */
export function getEffectiveQuestionDuration(
  question: { type: string; audioDurationSec?: number | null },
  baseDurationSec: number,
): number {
  if (question.type !== 'listening') {
    return baseDurationSec;
  }
  return baseDurationSec + (question.audioDurationSec ?? LISTENING_FALLBACK_SEC);
}
