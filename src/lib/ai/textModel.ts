/**
 * textModel.ts — AI 文字生成統一入口（provider 分流與備援）
 *
 * 規則：付費（isProOrAbove）且有 ANTHROPIC_API_KEY → Claude，失敗自動 fallback Gemini；
 *       免費 / 未登入 / 無 auth context（學生端、CLI）→ 直接 Gemini。
 * 背景：2026-07-16 Anthropic 額度歸零導致所有 Claude-only 功能整頁炸，
 *       spec: docs/superpowers/specs/2026-07-16-ai-provider-fallback-design.md
 */
import Anthropic from '@anthropic-ai/sdk';
import { auth } from '@clerk/nextjs/server';
import { GoogleGenAI } from '@google/genai';

import { isProOrAbove } from '@/libs/Plan';

type GenerateAITextOptions = {
  prompt: string; // 完整使用者 prompt（單輪文字）
  system?: string; // system prompt（Gemini 端會前綴到 prompt）
  claudeModel?: string; // 預設 claude-sonnet-4-6
  claudeThinking?: boolean; // Opus 4.8 需開 adaptive thinking
  maxTokens?: number; // 預設 4096
  json?: boolean; // true 時 Gemini 開 JSON mode
  forceGemini?: boolean; // 呼叫端已自行嘗試過 Claude 失敗時，跳過 Claude 直接走 Gemini
};

/** 決定首選 provider（純函式，可測） */
export function resolveAIProvider(isPro: boolean, hasClaudeKey: boolean): 'claude' | 'gemini' {
  return isPro && hasClaudeKey ? 'claude' : 'gemini';
}

/** isProOrAbove 安全版：無 auth context（學生端、CLI）時視為 free，不 throw */
export async function isProSafe(): Promise<boolean> {
  try {
    // 先取得真實 userId，再查方案；無 auth context 時視為 free
    const { userId } = await auth();
    if (!userId) {
      return false;
    }
    return await isProOrAbove(userId);
  } catch {
    return false;
  }
}

async function callClaude(opts: GenerateAITextOptions): Promise<string> {
  const client = new Anthropic();
  // 串流聚合避免長輸出撞 HTTP 逾時（比照 generate-subject 既有寫法）
  const stream = client.messages.stream({
    model: opts.claudeModel ?? 'claude-sonnet-4-6',
    max_tokens: opts.maxTokens ?? 4096,
    ...(opts.claudeThinking ? { thinking: { type: 'adaptive' as const } } : {}),
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: 'user', content: opts.prompt }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') {
    throw new Error('模型拒絕生成此內容');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error('輸出被 max_tokens 截斷');
  }
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');
}

async function callGemini(opts: GenerateAITextOptions): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('AI 服務未設定（缺少 GEMINI_API_KEY）');
  }
  const gemini = new GoogleGenAI({ apiKey: key });
  // Gemini 無獨立 system 欄位使用習慣（比照本專案既有寫法），前綴到 prompt
  const fullPrompt = opts.system ? `${opts.system}\n\n---\n\n${opts.prompt}` : opts.prompt;
  const response = await gemini.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
    config: {
      maxOutputTokens: opts.maxTokens ?? 4096,
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
      // 關掉 thinking 讓 token 全給輸出（比照 generate-questions）
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  const text = response.text ?? '';
  const finishReason = response.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== 'STOP') {
    throw new Error(`Gemini 輸出異常（finishReason=${finishReason}）`);
  }
  if (!text) {
    throw new Error('Gemini 回傳空內容');
  }
  return text;
}

/**
 * 統一文字生成：付費走 Claude（失敗自動 fallback Gemini）、免費走 Gemini。
 * 兩個 provider 都失敗才 throw，讓呼叫端自己的錯誤處理接手。
 */
export async function generateAIText(
  opts: GenerateAITextOptions,
): Promise<{ text: string; usedModel: 'claude' | 'gemini' }> {
  const isPro = await isProSafe();
  const provider = resolveAIProvider(isPro, Boolean(process.env.ANTHROPIC_API_KEY?.trim()));
  if (!opts.forceGemini && provider === 'claude') {
    try {
      return { text: await callClaude(opts), usedModel: 'claude' };
    } catch (err) {
      console.warn('[textModel] Claude 失敗，fallback Gemini：', err instanceof Error ? err.message : err);
    }
  }
  return { text: await callGemini(opts), usedModel: 'gemini' };
}
