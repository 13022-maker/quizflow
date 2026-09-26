import { z } from 'zod';

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

export const SampleInputSchema = z.object({
  content: z.string().trim().min(1, '範例答案內容不可為空').max(3000, '範例答案最多 3000 字'),
  ref: RubricRefSchema,
});

export const ReviewSetInputSchema = z.object({
  title: z.string().trim().min(1, '請輸入標題').max(100, '標題最多 100 字'),
  topicPrompt: z.string().trim().min(1, '請輸入延伸創作指示').max(1000, '指示最多 1000 字'),
  teamSize: z.number().int().min(2).max(8),
  reviewDurationSec: z.number().int().min(60).max(3600),
  createDurationSec: z.number().int().min(60).max(3600),
  samples: z.array(SampleInputSchema).min(1, '至少要有 1 則範例答案').max(10, '最多 10 則範例答案'),
});
export type ReviewSetInput = z.infer<typeof ReviewSetInputSchema>;
