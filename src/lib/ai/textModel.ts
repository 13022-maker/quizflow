/**
 * textModel.ts — AI 文字生成統一入口（provider 分流與備援）
 *
 * 規則：付費（isProOrAbove）且有 ANTHROPIC_API_KEY → Claude，失敗自動 fallback Gemini；
 *       免費 / 未登入 / 無 auth context（學生端、CLI）→ 直接 Gemini；
 *       Gemini 失敗且非 forceGemini 時也會補打一次 Claude；
 *       Gemini 本身失敗（含 Gemini 帳號 key pool 都試過）會先補打 Grok；
 *       Claude／Gemini／Grok 全部（含各自備用帳號）都失敗，最後補打 OpenAI（gpt-4o-mini）。
 * 每個 provider 內部還有一層帳號 key pool（見 getApiKeyPool）：主帳號額度用完
 * （單一帳號的限流/超額），會換下一組備用帳號的 key 重試，不會直接判定整個
 * provider 都不能用。備用帳號 key 放在 ANTHROPIC_API_KEY_BACKUP／
 * GEMINI_API_KEY_BACKUP／GROK_API_KEY_BACKUP／OPENAI_API_KEY_BACKUP（逗號分隔可放
 * 多組），沒設就是空陣列，行為與過去相同。
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
 * 判斷 Gemini 失敗後要不要補打一次 Claude 當最後手段（純函式，可測）。
 * 只有「這次呼叫本來就沒試過 Claude」（provider !== 'claude'，即免費方案自然分流到 Gemini）
 * 且「呼叫端沒有主動要求 forceGemini」（forceGemini 是呼叫端為了控制成本刻意跳過 Claude，
 * 例如生成學科避免試用戶燒 Opus token，這裡要尊重那個決定）且「有設定 Claude 金鑰」時才補打。
 */
export function shouldFallbackToClaudeAfterGemini(
  opts: { forceGemini?: boolean },
  provider: 'claude' | 'gemini',
  hasClaudeKey: boolean,
): boolean {
  return !opts.forceGemini && provider !== 'claude' && hasClaudeKey;
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
 * 組出一個 provider 的 API key 清單：主帳號優先，後面接備用帳號（逗號分隔字串，
 * 每組 trim、過濾空字串）。純函式，可測。
 */
export function getApiKeyPool(primary: string | undefined, backupCsv: string | undefined): string[] {
  const backups = (backupCsv ?? '').split(',').map(k => k.trim()).filter(Boolean);
  const trimmedPrimary = primary?.trim();
  return trimmedPrimary ? [trimmedPrimary, ...backups] : backups;
}

/**
 * 依序嘗試 key pool 裡的每一組 key，直到成功或全部用完。
 * 用來因應「單一帳號額度用完」：換一組不同帳號的 key 重打，而不是直接判定整個
 * provider 都不能用。空 pool 直接丟出明確錯誤，不會呼叫 fn。
 */
export async function callWithKeyPool<T>(
  keys: string[],
  fn: (key: string) => Promise<T>,
): Promise<T> {
  if (keys.length === 0) {
    throw new Error('AI 服務未設定（缺少 API key）');
  }
  let lastErr: unknown;
  for (const key of keys) {
    try {
      return await fn(key);
    } catch (err) {
      lastErr = err;
      console.warn('[textModel] key pool 其中一組帳號失敗，換下一組：', err instanceof Error ? err.message : err);
    }
  }
  throw lastErr;
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

async function callClaude(opts: GenerateAITextOptions, apiKey: string): Promise<string> {
  const client = new Anthropic({ apiKey });
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

/**
 * OpenAI 相容的 chat completions API 共用邏輯（OpenAI 本身跟 xAI Grok 都吃這個介面，
 * REST 直打，跟 generate-questions/route.ts 既有第三備援同款寫法）。
 */
async function callOpenAICompatible(
  opts: GenerateAITextOptions,
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<string> {
  const messages = opts.system
    ? [{ role: 'system', content: opts.system }, { role: 'user', content: opts.prompt }]
    : [{ role: 'user', content: opts.prompt }];
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: opts.maxTokens ?? 4096,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`${model} ${res.status}: ${errBody.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text) {
    throw new Error(`${model} 回傳空內容`);
  }
  return text;
}

async function callOpenAI(opts: GenerateAITextOptions, apiKey: string): Promise<string> {
  return callOpenAICompatible(opts, apiKey, 'https://api.openai.com/v1', 'gpt-4o-mini');
}

async function callGrok(opts: GenerateAITextOptions, apiKey: string): Promise<string> {
  return callOpenAICompatible(opts, apiKey, 'https://api.x.ai/v1', 'grok-4-fast');
}

async function callGemini(opts: GenerateAITextOptions, apiKey: string): Promise<string> {
  const gemini = new GoogleGenAI({ apiKey });
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
 * 統一文字生成入口：Claude／Gemini（Gemini 失敗會先試 Grok，見
 * generateWithClaudeAndGemini／callGeminiThenGrok）都失敗時，補打 OpenAI
 * （`gpt-4o-mini`）當最後一道防線，全部 provider 都沒設定/都失敗才 throw。
 * OpenAI 一樣支援 OPENAI_API_KEY_BACKUP 多帳號 key pool。這一層不分 forceGemini／
 * 付費與否，是全域最後手段，避免主要 provider 剛好同時撞額度時整個生成失敗。
 */
export async function generateAIText(
  opts: GenerateAITextOptions,
): Promise<{ text: string; usedModel: 'claude' | 'gemini' | 'grok' | 'openai' }> {
  try {
    return await generateWithClaudeAndGemini(opts);
  } catch (err) {
    const openaiKeys = getApiKeyPool(process.env.OPENAI_API_KEY, process.env.OPENAI_API_KEY_BACKUP);
    if (openaiKeys.length === 0) {
      throw err;
    }
    console.warn('[textModel] Claude／Gemini（含各自備用帳號）皆失敗，fallback OpenAI 最後防線：', err instanceof Error ? err.message : err);
    const text = await callWithKeyPool(openaiKeys, key => withAIRetry(() => callOpenAI(opts, key)));
    return { text, usedModel: 'openai' };
  }
}

/**
 * 打 Gemini，失敗（含 Gemini 自己的整個帳號 key pool 都試過）就補打一次 Grok 當
 * Gemini 專屬的備援，兩個都失敗才 throw。GROK_API_KEY 沒設（grokKeys 空陣列）時
 * 直接跳過，行為等同過去只有 Gemini。
 */
async function callGeminiThenGrok(
  opts: GenerateAITextOptions,
  geminiKeys: string[],
  grokKeys: string[],
): Promise<{ text: string; usedModel: 'gemini' | 'grok' }> {
  try {
    const text = await callWithKeyPool(geminiKeys, key => withAIRetry(() => callGemini(opts, key)));
    return { text, usedModel: 'gemini' };
  } catch (err) {
    if (grokKeys.length === 0) {
      throw err;
    }
    console.warn('[textModel] Gemini（含備用帳號）皆失敗，fallback Grok：', err instanceof Error ? err.message : err);
    const text = await callWithKeyPool(grokKeys, key => withAIRetry(() => callGrok(opts, key)));
    return { text, usedModel: 'grok' };
  }
}

/**
 * 付費走 Claude（失敗自動 fallback Gemini）、免費走 Gemini
 * （Gemini 失敗且非 forceGemini 時，會補打一次 Claude 當最後手段，見
 * shouldFallbackToClaudeAfterGemini）。Gemini 本身失敗時會先試 Grok
 * （callGeminiThenGrok），Grok 也失敗才算 Gemini 這條路徹底斷了。
 * 每個 provider 內部先跑 key pool（主帳號＋ *_API_KEY_BACKUP 逗號分隔的備用帳號，
 * 見 getApiKeyPool／callWithKeyPool）：單一帳號額度用完就換下一組帳號的 key；
 * 每組 key 呼叫都包了 withAIRetry：暫時性錯誤（限流/過載/5xx）先重試 3 次再放棄。
 * Claude／Gemini／Grok 都試過還失敗才 throw，交給 generateAIText 決定要不要再退到
 * OpenAI。
 */
async function generateWithClaudeAndGemini(
  opts: GenerateAITextOptions,
): Promise<{ text: string; usedModel: 'claude' | 'gemini' | 'grok' }> {
  const isPro = await isProSafe();
  const claudeKeys = getApiKeyPool(process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_API_KEY_BACKUP);
  const geminiKeys = getApiKeyPool(process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_BACKUP);
  const grokKeys = getApiKeyPool(process.env.GROK_API_KEY, process.env.GROK_API_KEY_BACKUP);
  const hasClaudeKey = claudeKeys.length > 0;
  const provider = resolveAIProvider(isPro, hasClaudeKey);

  if (!opts.forceGemini && provider === 'claude') {
    try {
      const text = await callWithKeyPool(claudeKeys, key => withAIRetry(() => callClaude(opts, key)));
      return { text, usedModel: 'claude' };
    } catch (err) {
      console.warn('[textModel] Claude（含備用帳號）皆失敗，fallback Gemini：', err instanceof Error ? err.message : err);
    }
    return callGeminiThenGrok(opts, geminiKeys, grokKeys);
  }

  try {
    return await callGeminiThenGrok(opts, geminiKeys, grokKeys);
  } catch (err) {
    if (shouldFallbackToClaudeAfterGemini(opts, provider, hasClaudeKey)) {
      console.warn('[textModel] Gemini／Grok 皆失敗，fallback Claude：', err instanceof Error ? err.message : err);
      const text = await callWithKeyPool(claudeKeys, key => withAIRetry(() => callClaude(opts, key)));
      return { text, usedModel: 'claude' };
    }
    throw err;
  }
}
