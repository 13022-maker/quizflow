import { z } from 'zod';

import { SampleInputSchema } from '@/lib/reviewSetSchema';

export const GeneratedReviewSetSchema = z.object({
  topicPrompt: z.string().trim().min(1).max(1000),
  samples: z.array(SampleInputSchema).length(3),
});
export type GeneratedReviewSet = z.infer<typeof GeneratedReviewSetSchema>;

/**
 * 從 AI 回應文字中抽出 JSON 物件並驗證格式。AI 有時會在 JSON 前後夾雜說明文字，
 * 用 regex 抓出第一個 { 到最後一個 } 之間的內容（跟 generate-questions/route.ts 同款做法）。
 * 解析或驗證失敗一律回傳 null（fail-open，讓呼叫端決定要重試還是報錯）。
 */
export function parseGeneratedReviewSet(raw: string): GeneratedReviewSet | null {
  const match = raw.match(/\{[\s\S]*\}/);
  const jsonText = match ? match[0] : raw;

  let json: unknown;
  try {
    json = JSON.parse(jsonText);
  } catch {
    return null;
  }

  const parsed = GeneratedReviewSetSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export function buildReviewSetPrompt(title: string): string {
  return `你是台灣中小學老師的教學設計助手。請針對以下主題，設計一份「小組協作批閱創作題」的活動內容。

主題：
${title}

這個活動的玩法：學生小組會先閱讀 3 則範例答案並打分數（正確性、完整性、清晰度、創意，各 0-5 分），
接著小組討論、截長補短，共同創作一個延伸答案。

請產生：
1. topicPrompt：給小組的延伸創作指示（1-2 句話，說明評分方式與最後要交出什麼），繁體中文
2. samples：恰好 3 則範例答案，內容與主題相關、符合台灣中小學生的口吻與程度，且**必須刻意拉開品質差距**：
   - 第 1 則：明顯薄弱（內容空泛、缺乏具體細節），對應標準分每個維度約 1-2 分
   - 第 2 則：中等（有基本內容但不夠完整），對應標準分每個維度約 3 分
   - 第 3 則：完整且有創意（具體、有細節、有創新點），對應標準分每個維度約 4-5 分

規則：
1. 只回傳合法 JSON，不要 markdown 或任何說明文字
2. 每則範例答案的 content 是學生口吻寫的一段文字（50-150 字），不要用條列式
3. JSON 格式：
{
  "topicPrompt": "給小組的延伸創作指示",
  "samples": [
    { "content": "第一則範例答案內容", "ref": { "correctness": 2, "completeness": 1, "clarity": 2, "creativity": 1 } },
    { "content": "第二則範例答案內容", "ref": { "correctness": 3, "completeness": 3, "clarity": 3, "creativity": 3 } },
    { "content": "第三則範例答案內容", "ref": { "correctness": 5, "completeness": 5, "clarity": 4, "creativity": 5 } }
  ]
}
所有文字使用繁體中文。`;
}
