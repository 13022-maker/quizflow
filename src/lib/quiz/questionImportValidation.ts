/**
 * questionImportValidation.ts — POST /api/quizzes/[id]/questions 的輸入驗證
 *
 * 過去 route 直接把 body.questions 交給 buildQuestionInsertRows，沒有任何驗證：
 * 題幹空白、選項非陣列的題目會變成壞資料寫進 DB，型別錯誤則在 insert 時炸 500。
 * 這裡逐題用 Zod 檢查，壞的題目剔除並計數（dropped），合法的原樣保留。
 *
 * 刻意只擋「結構上一定有問題」的題目；選擇題答案對不到選項這種「內容」問題維持既有行為
 * （存成無正解讓老師在編輯器補），不在這裡丟棄。
 */
import { z } from 'zod';

import type { GeneratedQuestion } from './questionRows';

const nonEmptyString = z.string().refine(s => s.trim().length > 0);

// passthrough：保留 explanation / diagramSvg / imageUrl 等額外欄位交給 buildQuestionInsertRows
const importQuestionSchema = z.object({
  type: z.enum(['mc', 'tf', 'fill', 'short', 'rank', 'listening', 'cloze']),
  question: nonEmptyString,
  options: z.array(nonEmptyString).optional(),
  answer: z.union([z.string(), z.array(z.string())]).optional(),
  explanation: z.string().optional(),
  listeningText: z.string().optional(),
  audioUrl: z.string().optional(),
  audioDurationSec: z.number().optional(),
  imageUrl: z.string().optional(),
  diagramSvg: z.string().optional(),
}).passthrough();

export function validateImportQuestions(
  input: unknown[],
): { questions: GeneratedQuestion[]; dropped: number } {
  const questions: GeneratedQuestion[] = [];
  let dropped = 0;
  for (const item of input) {
    const parsed = importQuestionSchema.safeParse(item);
    if (parsed.success) {
      questions.push(parsed.data as GeneratedQuestion);
    } else {
      dropped++;
    }
  }
  return { questions, dropped };
}
