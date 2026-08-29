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

import { getUserPlanId, isProOrAbove } from '@/libs/Plan';
import { PLAN_ID } from '@/utils/AppConfig';

// 一份多模態素材：mimeType + base64（跟 generate-from-file/route.ts 現有的同形狀 local type 對齊）
export type Media = { mimeType: string; base64: string };

type GenerateAITextOptions = {
  prompt: string; // 完整使用者 prompt（單輪文字）
  system?: string; // system prompt（Gemini 端會前綴到 prompt）
  claudeModel?: string; // 預設 claude-sonnet-4-6
  claudeThinking?: boolean; // Opus 4.8 需開 adaptive thinking
  maxTokens?: number; // 預設 4096
  json?: boolean; // true 時 Gemini 開 JSON mode
  forceGemini?: boolean; // 呼叫端已自行嘗試過 Claude 失敗時，跳過 Claude 直接走 Gemini
  media?: Media[]; // 多模態素材（PDF / 圖片）；Claude 走 image/document blocks，Gemini 走 inlineData
};

/** Claude 多模態 content blocks：image/ 開頭走 image type，其餘（PDF）走 document type（純函式，可測） */
export function buildClaudeMediaBlocks(
  media: Media[],
): (Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam)[] {
  return media.map((m): Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam =>
    m.mimeType.startsWith('image/')
      ? {
          type: 'image',
          source: {
            type: 'base64',
            media_type: m.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
            data: m.base64,
          },
        }
      : {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: m.base64 },
        },
  );
}

/** Gemini 多模態 parts：inlineData（純函式，可測） */
export function buildGeminiMediaParts(
  media: Media[],
): { inlineData: { mimeType: string; data: string } }[] {
  return media.map(m => ({ inlineData: { mimeType: m.mimeType, data: m.base64 } }));
}

/** 決定首選 provider（純函式，可測） */
export function resolveAIProvider(isPro: boolean, hasClaudeKey: boolean): 'claude' | 'gemini' {
  return isPro && hasClaudeKey ? 'claude' : 'gemini';
}

/**
 * 判斷這個錯誤是不是「暫時性、值得重試」的（純函式，可測）。
 * 429/529（限流/過載）、5xx（伺服器錯誤）、訊息含 overloaded 才算；
 * 400/401/403 這種請求本身有問題的錯誤，重試也不會變好，不列入。
 */
export function isRetryableAIError(err: unknown): boolean {
  const status = (err as { status?: number; code?: number } | null)?.status
    ?? (err as { code?: number } | null)?.code;
  return status === 429
    || status === 529
    || (typeof status === 'number' && status >= 500)
    || (err instanceof Error && err.message.includes('overloaded'));
}

/**
 * 通用重試 wrapper：可重試的錯誤失敗時遞增 backoff 重試，不可重試或試滿次數就拋出。
 *
 * 修復真實踩過的坑：簡答題 AI 評分（gradeShortAnswer → callGemini）過去完全沒有
 * 重試機制，短時間內大量學生同時交卷（各自獨立呼叫一次 Gemini API）很容易撞到
 * 限流，沒有 retry 就整批直接判定「AI 批改失敗，待老師複核」。這裡補齊跟
 * generate-from-file/route.ts 既有 callWithRetry 一致的防禦深度。
 */
export async function withAIRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; delayMs?: number } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const delayMs = options.delayMs ?? 1500;
  let lastErr: unknown;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryableAIError(err) || i === maxRetries - 1) {
        throw err;
      }
      await new Promise(resolve => setTimeout(resolve, (i + 1) * delayMs));
    }
  }
  // 理論上不會走到這裡（迴圈內一定 return 或 throw），保留給 TypeScript 型別檢查
  throw lastErr;
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

/**
 * 嚴格付費判定：只認 Paddle 訂閱（active/trialing/past_due），30 天免費試用不算。
 * 用於高成本生成（如生成學科的 Claude Opus）；getUserPlanId 只查訂閱表、從不看試用，
 * 正是「真付費」訊號。無 auth context（學生端、CLI）時安全回 false。
 */
export async function isPaidSubscriberSafe(): Promise<boolean> {
  try {
    const { userId } = await auth();
    if (!userId) {
      return false;
    }
    return (await getUserPlanId(userId)) !== PLAN_ID.FREE;
  } catch {
    return false;
  }
}

async function callClaude(opts: GenerateAITextOptions): Promise<string> {
  const client = new Anthropic();
  const content: Anthropic.MessageParam['content'] = opts.media?.length
    ? [...buildClaudeMediaBlocks(opts.media), { type: 'text', text: opts.prompt }]
    : opts.prompt;
  // 串流聚合避免長輸出撞 HTTP 逾時（比照 generate-subject 既有寫法）
  const stream = client.messages.stream({
    model: opts.claudeModel ?? 'claude-sonnet-4-6',
    max_tokens: opts.maxTokens ?? 4096,
    ...(opts.claudeThinking ? { thinking: { type: 'adaptive' as const } } : {}),
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: 'user', content }],
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
  const parts = [
    ...(opts.media?.length ? buildGeminiMediaParts(opts.media) : []),
    { text: fullPrompt },
  ];
  const response = await gemini.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts }],
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
 * 兩個 provider 呼叫都包了 withAIRetry：暫時性錯誤（限流/過載/5xx）先重試
 * 3 次再放棄，不是每次撞到限流就整個判定失敗（見 withAIRetry 註解）。
 * 兩個 provider 都失敗才 throw，讓呼叫端自己的錯誤處理接手。
 */
export async function generateAIText(
  opts: GenerateAITextOptions,
): Promise<{ text: string; usedModel: 'claude' | 'gemini' }> {
  const isPro = await isProSafe();
  const provider = resolveAIProvider(isPro, Boolean(process.env.ANTHROPIC_API_KEY?.trim()));
  if (!opts.forceGemini && provider === 'claude') {
    try {
      return { text: await withAIRetry(() => callClaude(opts)), usedModel: 'claude' };
    } catch (err) {
      console.warn('[textModel] Claude 失敗，fallback Gemini：', err instanceof Error ? err.message : err);
    }
  }
  return { text: await withAIRetry(() => callGemini(opts)), usedModel: 'gemini' };
}
