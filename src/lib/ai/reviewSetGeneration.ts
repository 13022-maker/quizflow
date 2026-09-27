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

// 「AI 時代思考」框架：白名單機制比照 generate-questions/route.ts 的 FRAMEWORK_PROMPTS，
// 未知 key 一律視為未指定，prompt 完全不變。framework 只在生成當下影響 prompt，不落庫。
export const AI_ERA_FRAMEWORK_KEY = 'ai-era-thinking';

export function buildReviewSetPrompt(title: string, framework?: string): string {
  const isAiEra = framework === AI_ERA_FRAMEWORK_KEY;

  const frameworkIntro = isAiEra
    ? `【框架：AI 時代思考】本題組要體現的教學理念是：AI 已經能給出還不錯的解答，學生要練習的是「AI 給完解答之後，還能往前多想一步」的能力。因此 3 則範例答案中的第 3 則要明確是「AI 生成的解答」，JSON 中該則的 "isAiAnswer" 要設為 true（其餘兩則為 false 或省略）。\n`
    : '';

  const taskAddendum = isAiEra
    ? `
   d. 任務指示要引導小組依「Polya 解題四步驟」重新評斷這則 AI 解答，並依同樣四步驟共創出明確超越、挑戰它的延伸答案，四步驟依序是：
      - 理解問題：AI 解答是否真的抓對題目的核心限制與條件？有沒有簡化或忽略掉題目原本的要求？
      - 擬定計畫：AI 採用的方法/策略是不是最適合的？有沒有更好的替代做法？
      - 執行計畫：AI 的解法過程有沒有邏輯漏洞、只處理部分情況、或有可以再精確的地方？
      - 回顧與檢討：這個解答能不能類推到其他情境？有沒有 AI 沒考慮到的邊界案例？
      小組共創的延伸答案必須明確回應以上至少一個步驟裡發現的問題，不能只是重述或小幅修改 AI 解答的內容。`
    : '';

  const sampleAddendum = isAiEra
    ? `
   - 第 3 則範例答案要改成「AI 生成解答」的定位：內容依然完整、有具體細節、切題（維持 4-5 分水準），可以安排故事情境裡「老師／學習系統先讓小組看過 AI 工具生成的解答」這樣的因果鏈事件，讓 AI 解答的出現合理地融入故事世界（**不要**用「以下是 AI 生成的答案」這種跳出故事的後設講法）。內容宜避免碰觸「情感、個人經驗、需要臨場互動」這類 AI 難以真正做到的向度，讓小組有明確可挑戰的施力點`
    : '';

  const jsonNote = isAiEra
    ? `\n若套用「AI 時代思考」框架，請在第 3 則 samples 的 JSON 物件加上 "isAiAnswer": true（其餘兩則設為 false 或省略此欄位，預設視為 false）。`
    : '';

  return `你是台灣中小學老師的教學設計助手。請針對以下主題，設計一份「小組協作批閱創作題」的活動內容。

主題：
${title}
${frameworkIntro}
這個活動的玩法：學生小組會先閱讀 3 則範例答案並打分數（正確性、完整性、清晰度、創意，各 0-5 分），
接著小組討論、截長補短，共同創作一個延伸答案。

請產生：
1. topicPrompt：先寫一段**故事情境**，再接給小組的延伸創作指示（說明評分方式與最後要交出什麼），繁體中文。故事情境寫作規則（三項都要遵守）：
   a. 用「但是／因此」因果鏈串起 2-4 個事件（[情境設定] 但是 [卡住的問題] 因此 [小組要解決的任務缺口]），**不要**用「然後」寫成流水帳
   b. 故事情境本身（不含後面的任務指示）控制在 **150 字以內**，讀故事的時間不能吃掉小組作答的時間
   c. 用「以物觀物」視角：只描述情境中人事物實際做了什麼、發生了什麼因果，**不要**加「真是太神奇了、讓我們一起、你一定會」這類敘事者替讀者代言感受的說教語氣${taskAddendum}
2. samples：恰好 3 則範例答案，內容延續故事情境的世界觀（同一個情境裡角色寫出來的東西）、符合台灣中小學生的口吻與程度，且**必須刻意拉開品質差距**：
   - 第 1 則：明顯薄弱（內容空泛、缺乏具體細節），對應標準分每個維度約 1-2 分
   - 第 2 則：中等（有基本內容但不夠完整），對應標準分每個維度約 3 分
   - 第 3 則：完整且有創意（具體、有細節、有創新點），對應標準分每個維度約 4-5 分${sampleAddendum}

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
}${jsonNote}
所有文字使用繁體中文。`;
}
