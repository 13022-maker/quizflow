import { z } from 'zod';

import { validateCreateModeSet } from '@/services/review/createModes';
import { getModeHandler, REVIEW_CREATE_MODES, REVIEW_MODES } from '@/services/review/modes';

// 協作批閱題組的輸入 Zod schema。獨立成一個純模組（非 'use server'）是因為
// Next.js 規定 'use server' 檔案只能匯出 async function，不能匯出 Zod schema
// 這種一般值——所以不能放在 reviewSetActions.ts 裡，AI 生成（reviewSetGeneration.ts）
// 跟表單驗證（reviewSetActions.ts）共用同一份定義。
export const RubricRefSchema = z.object({
  correctness: z.number().int().min(0).max(5),
  completeness: z.number().int().min(0).max(5),
  clarity: z.number().int().min(0).max(5),
  creativity: z.number().int().min(0).max(5),
});

const ZERO_REF = { correctness: 0, completeness: 0, clarity: 0, creativity: 0 };

export const SampleInputSchema = z.object({
  content: z.string().trim().min(1, '範例答案內容不可為空').max(3000, '範例答案最多 3000 字'),
  // rubric 題型的老師標準分；其他題型不用，省略時補 0
  ref: RubricRefSchema.default(ZERO_REF),
  isAiAnswer: z.boolean().default(false), // 是否明確標示為「AI 生成的解答」；預設 false 向後相容
  // 非 rubric 題型的標準答案，形狀由題型 handler 的 refSchema 決定，這層只收 unknown，
  // 實際驗證在 validateReviewSetModes()
  refData: z.unknown().optional(),
});

export const ReviewSetInputSchema = z.object({
  title: z.string().trim().min(1, '請輸入標題').max(100, '標題最多 100 字'),
  topicPrompt: z.string().trim().min(1, '請輸入延伸創作指示').max(1000, '指示最多 1000 字'),
  teamSize: z.number().int().min(2).max(8),
  reviewDurationSec: z.number().int().min(60).max(3600),
  createDurationSec: z.number().int().min(60).max(3600),
  samples: z.array(SampleInputSchema).min(1, '至少要有 1 則範例答案').max(10, '最多 10 則範例答案'),
  reviewMode: z.enum(REVIEW_MODES).default('rubric'),
  createMode: z.enum(REVIEW_CREATE_MODES).default('free_text'),
});
export type ReviewSetInput = z.input<typeof ReviewSetInputSchema>;
export type ReviewSetParsed = z.infer<typeof ReviewSetInputSchema>;

/**
 * 依題型驗證每則範例答案的 refData + 整組規則，並把 refData 正規化成 refSchema
 * parse 後的值（rubric 題型一律清成 null）。保持 ReviewSetInputSchema 是純 ZodObject
 * （reviewActions 會用 .shape.teamSize），所以題型驗證另外拆成這支函式。
 */
export function validateReviewSetModes(
  data: ReviewSetParsed,
): { ok: true; samples: (ReviewSetParsed['samples'][number] & { refData: unknown })[] } | { ok: false; error: string } {
  const createModeError = validateCreateModeSet(data.createMode);
  if (createModeError) {
    return { ok: false, error: createModeError };
  }
  const handler = getModeHandler(data.reviewMode);
  const samples: (ReviewSetParsed['samples'][number] & { refData: unknown })[] = [];
  for (const [i, s] of data.samples.entries()) {
    if (handler.refSchema === null) {
      samples.push({ ...s, refData: null });
      continue;
    }
    const parsed = handler.refSchema.safeParse(s.refData);
    if (!parsed.success) {
      return { ok: false, error: `第 ${i + 1} 則範例答案：${parsed.error.errors[0]?.message ?? '標準答案格式錯誤'}` };
    }
    samples.push({ ...s, refData: parsed.data });
  }
  const setError = handler.validateSet(samples.map(s => ({ content: s.content, refData: s.refData })));
  if (setError) {
    return { ok: false, error: setError };
  }
  return { ok: true, samples };
}
