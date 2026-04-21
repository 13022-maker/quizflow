// Live Mode 計分與判對邏輯。
// 重要：所有計分/判對**必須**在 server 端執行（API Route 內），client 只送選項 id。

import type { LiveQuestionType } from './types';

/**
 * Live Mode 計分公式（Kahoot 風格快答加分）：
 * - 答錯：0
 * - 逾時：0
 * - 答對：1000 * (1 - responseMs / durationMs * 0.5)，但最低 500
 */
export function calcLiveScore(
  isCorrect: boolean,
  responseMs: number,
  durationMs: number,
): number {
  if (!isCorrect) {
    return 0;
  }
  if (responseMs >= durationMs) {
    return 0;
  }
  const ratio = Math.max(0, responseMs) / durationMs;
  const raw = 1000 * (1 - ratio * 0.5);
  return Math.max(500, Math.round(raw));
}

/**
 * 判斷答案是否正確。MVP 僅支援三種選擇題。
 * - single_choice / true_false：selectedOptionId 是 string，比對 correctAnswers[0]
 * - multiple_choice：selectedOptionId 是 string[]，集合相等才算對
 * - 其他題型：MVP 不支援，一律回傳 false
 */
export function gradeAnswer(
  questionType: string,
  correctAnswers: string[] | null,
  selectedOptionId: string | string[] | null,
): boolean {
  if (!correctAnswers || correctAnswers.length === 0) {
    return false;
  }
  if (selectedOptionId === null || selectedOptionId === undefined) {
    return false;
  }

  switch (questionType) {
    case 'single_choice':
    case 'true_false': {
      if (typeof selectedOptionId !== 'string') {
        return false;
      }
      return correctAnswers[0] === selectedOptionId;
    }
    case 'multiple_choice': {
      if (!Array.isArray(selectedOptionId)) {
        return false;
      }
      if (selectedOptionId.length !== correctAnswers.length) {
        return false;
      }
      const picked = new Set(selectedOptionId);
      const correct = new Set(correctAnswers);
      if (picked.size !== correct.size) {
        return false;
      }
      for (const id of picked) {
        if (!correct.has(id)) {
          return false;
        }
      }
      return true;
    }
    default:
      return false;
  }
}

export const LIVE_SUPPORTED_TYPES: LiveQuestionType[] = [
  'single_choice',
  'multiple_choice',
  'true_false',
];

export function isLiveSupportedType(type: string): type is LiveQuestionType {
  return (LIVE_SUPPORTED_TYPES as string[]).includes(type);
}
