'use server';

import Anthropic from '@anthropic-ai/sdk';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';

import { Env } from '@/libs/Env';
import { isProOrAbove } from '@/libs/Plan';

// 回傳給前端的單一題目格式
export type AIGeneratedQuestion = {
  body: string;
  options: { id: string; text: string }[];
  correctAnswers: string[];
};

// 輸入驗證
const InputSchema = z.object({
  topic: z.string().min(2, '請輸入至少 2 個字').max(500),
  count: z.number().int().min(1).max(10).default(5),
});

export type GenerateQuestionsResult =
  | { success: true; questions: AIGeneratedQuestion[] }
  | { success: false; error: string; upgradeRequired?: boolean };

/**
 * 多層容錯解析 AI 回傳的 JSON 字串
 * 1. 先去除 markdown code block 包裝
 * 2. 直接嘗試 JSON.parse
 * 3. 若失敗，用正則抽取第一個 [...] 區塊再 parse
 */
function parseQuestionsJSON(text: string): AIGeneratedQuestion[] | null {
  // 去除 markdown code block 與前後多餘空白
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  // 第一次嘗試：直接解析
  try {
    const result = JSON.parse(cleaned);
    if (Array.isArray(result) && result.length > 0) {
      return result as AIGeneratedQuestion[];
    }
  } catch {
    // 繼續嘗試下一步
  }

  // 第二次嘗試：用正則從回應中提取第一個 JSON 陣列（[ ... ]）
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const result = JSON.parse(match[0]);
      if (Array.isArray(result) && result.length > 0) {
        return result as AIGeneratedQuestion[];
      }
    } catch {
      // 解析仍失敗，回傳 null
    }
  }

  return null;
}

/**
 * 呼叫 Claude API 自動生成繁體中文單選題
 * 僅限 Pro / Enterprise 用戶使用
 */
export async function generateAIQuestions(
  input: { topic: string; count?: number },
): Promise<GenerateQuestionsResult> {
  const { orgId } = await auth();
  if (!orgId) {
    return { success: false, error: '請先登入' };
  }

  // 檢查是否為付費方案
  const hasPro = await isProOrAbove(orgId);
  if (!hasPro) {
    return { success: false, error: '此功能僅限 Pro 方案使用', upgradeRequired: true };
  }

  // 驗證輸入
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? '輸入格式錯誤' };
  }

  const { topic, count } = parsed.data;

  if (!Env.ANTHROPIC_API_KEY) {
    return { success: false, error: '尚未設定 ANTHROPIC_API_KEY，請聯絡管理員' };
  }

  const client = new Anthropic({ apiKey: Env.ANTHROPIC_API_KEY });

  const systemPrompt = `你是一位台灣的出題專家，專門根據指定主題出繁體中文單選題。

【輸出規則】
- 你的回應必須是且只能是一個合法的 JSON 陣列
- 第一個字元必須是 [，最後一個字元必須是 ]
- 不得包含任何說明文字、markdown 符號、code block（不要用 \`\`\`）
- 題目、選項文字中不得使用未跳脫的換行符號或控制字元

【JSON 格式範例（直接照此結構輸出）】
[
  {
    "body": "下列何者是光合作用的產物？",
    "options": [
      { "id": "a", "text": "二氧化碳" },
      { "id": "b", "text": "葡萄糖" },
      { "id": "c", "text": "水分子" },
      { "id": "d", "text": "氮氣" }
    ],
    "correctAnswers": ["b"]
  }
]

【出題規則】
- 每題恰好 4 個選項，id 依序為 "a", "b", "c", "d"
- correctAnswers 只含一個正確選項的 id（字串陣列）
- 題目清楚明確，難度適中（高中程度）
- 所有文字使用繁體中文
- 直接輸出 JSON 陣列，第一個字是 [，最後一個字是 ]，無任何其他內容`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `請針對以下主題出 ${count} 道單選題：\n\n${topic}`,
        },
      ],
      system: systemPrompt,
    });

    // 取得回應文字
    const content = message.content[0];
    if (!content || content.type !== 'text') {
      return { success: false, error: 'AI 回應格式異常' };
    }

    // 解析 JSON，加入多層容錯機制
    const questions = parseQuestionsJSON(content.text);
    if (!questions) {
      return { success: false, error: 'AI 回應的題目格式不正確，請再試一次' };
    }

    return { success: true, questions };
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知錯誤';
    return { success: false, error: `AI 出題失敗：${message}` };
  }
}
