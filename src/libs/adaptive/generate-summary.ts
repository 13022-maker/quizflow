/**
 * AI 生成課前重點摘要講義：根據學科知識點圖譜，為老師生成一份 Markdown 全文，
 * 幫老師上課前快速掌握這個單元要教什麼、學生容易卡在哪。
 * 驗證模式仿 generate-subject.ts：結構化 JSON → zod 驗證 → 失敗重試一次。
 */
import { z } from 'zod';

import { generateAIText, isPaidSubscriberSafe } from '@/lib/ai/textModel';

import { extractJson } from './generate-subject';
import type { Subject } from './subjects';

const summaryOutputSchema = z.object({
  overview: z.string().min(1).max(200),
  keyPoints: z.array(z.object({
    concept: z.string().min(1).max(30),
    note: z.string().min(1).max(200),
  })).min(1),
  teachingTips: z.array(z.string().min(1)).max(5),
});

export type SummaryOutput = z.infer<typeof summaryOutputSchema>;

const SYSTEM_PROMPT = `你是台灣中學／大學教學設計專家，要為老師生成「課前重點摘要講義」，
幫老師在上課前快速掌握這個學科單元要教什麼、學生容易卡在哪。

輸出要求：只輸出一個 JSON 物件（不要 Markdown 圍欄、不要任何說明文字），結構如下：
{
  "overview": "本課概述，1-2句話說明這個單元學生要學會什麼",
  "keyPoints": [
    { "concept": "知識點名稱（對應輸入的知識點）", "note": "這個知識點的重點說明，1句話" }
  ],
  "teachingTips": ["教學建議或學生常見錯誤提醒，可以是空陣列"]
}`;

/** 組使用者 prompt：學科名稱 + 依教學順序排列的知識點清單 */
export function buildUserPrompt(subject: Subject): string {
  const pointList = subject.graph.nodes.map(n => `- ${n.name}`).join('\n');
  return `學科：${subject.name}\n涵蓋知識點（依教學順序排列）：\n${pointList}\n\n請針對以上知識點生成課前重點摘要。`;
}

/** 把結構化生成結果組成 Markdown 全文；教學建議為空陣列時不輸出該節 */
export function renderMarkdown(subjectName: string, data: SummaryOutput): string {
  const points = data.keyPoints.map(p => `- **${p.concept}**：${p.note}`).join('\n');
  const tips = data.teachingTips.length > 0
    ? `\n\n## 教學建議\n${data.teachingTips.map(t => `- ${t}`).join('\n')}`
    : '';
  return `# ${subjectName} 課前重點\n\n## 本課概述\n${data.overview}\n\n## 知識點重點\n${points}${tips}`;
}

/** 生成課前重點摘要講義（Markdown 全文）。格式驗證失敗重試一次，兩次都失敗才丟錯。 */
export async function generateSubjectSummary(subject: Subject): Promise<string> {
  const forceGemini = !(await isPaidSubscriberSafe());
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const retryNote = lastError
      ? `\n\n【上次生成有以下問題，請修正後重新生成】\n${lastError}`
      : '';
    const { text } = await generateAIText({
      prompt: buildUserPrompt(subject) + retryNote,
      system: SYSTEM_PROMPT,
      json: true,
      forceGemini,
    });
    try {
      const parsed = summaryOutputSchema.parse(extractJson(text));
      return renderMarkdown(subject.name, parsed);
    } catch (error) {
      lastError = (error as Error).message;
    }
  }
  throw new Error(`AI 生成的摘要格式驗證失敗：${lastError}`);
}
