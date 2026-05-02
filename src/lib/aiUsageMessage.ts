// AI 出題完成後在 QuizEditor importSuccess banner 顯示的本月用量訊息
// 規則:
//   - quota >= 999 (Pro / Trial / VIP) → 「本月第 N 次 AI 出題 · Pro 無上限 ✨」
//   - quota <  999 且 remaining >  2  → 「本月 N / Q 次 · 還剩 R 次」
//   - quota <  999 且 remaining <= 2  → 「本月 N / Q 次 · 只剩 R 次,升級 Pro 解鎖無限」(紅字)
// remaining === 0 不會走到此 helper(API route 已先擋下)

export type AiUsageInfo = {
  quota: number;
  used: number;
  remaining: number;
};

export type AiUsageMessage = {
  text: string;
  isWarning: boolean;
};

const PRO_THRESHOLD = 999;
const LOW_REMAINING_THRESHOLD = 2;

export function formatAiUsageMessage(usage: AiUsageInfo): AiUsageMessage {
  const { quota, used, remaining } = usage;

  if (quota >= PRO_THRESHOLD) {
    return {
      text: `本月第 ${used} 次 AI 出題 · Pro 無上限 ✨`,
      isWarning: false,
    };
  }

  if (remaining <= LOW_REMAINING_THRESHOLD) {
    return {
      text: `本月 ${used} / ${quota} 次 · 只剩 ${remaining} 次,升級 Pro 解鎖無限`,
      isWarning: true,
    };
  }

  return {
    text: `本月 ${used} / ${quota} 次 · 還剩 ${remaining} 次`,
    isWarning: false,
  };
}
