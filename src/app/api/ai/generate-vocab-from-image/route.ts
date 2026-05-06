/**
 * AI 從照片識別物件 → 生成中英單字對 API（拍照模式專用）
 * 輸入：multipart formData { image: File, difficulty?: string }
 * 輸出：{ title, words: [{ english, chinese, example? }] }
 *
 * 主用 Gemini 2.5 Flash（多模態識物精準度高、便宜），過載時 fallback Claude Sonnet 4
 */

import { Buffer } from 'node:buffer';

import Anthropic from '@anthropic-ai/sdk';
import { auth } from '@clerk/nextjs/server';
import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

import { checkAndIncrementAiUsage } from '@/actions/aiUsageActions';

export const runtime = 'nodejs';
export const maxDuration = 60;

const GEMINI_MODEL_NAME = 'gemini-2.5-flash';
const CLAUDE_MODEL_NAME = 'claude-sonnet-4-20250514';

const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY?.trim());
const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

const genAI = hasGeminiKey
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })
  : null;
const anthropic = hasAnthropicKey ? new Anthropic() : null;

// 過載時自動重試,跟 generate-from-file 同 pattern
async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number; code?: number }).status
        ?? (err as { code?: number }).code;
      const retryable
        = status === 429
        || status === 529
        || (typeof status === 'number' && status >= 500)
        || (err instanceof Error && err.message.includes('overloaded'));
      if (!retryable || i === maxRetries - 1) {
        throw err;
      }
      await new Promise(r => setTimeout(r, (i + 1) * 1500));
    }
  }
  throw new Error('AI API 目前過載，請稍後再試');
}

const DIFF_LABELS: Record<string, string> = {
  easy: '初級（國中基礎、日常生活）',
  medium: '中級（高中、全民英檢中級）',
  hard: '進階（學測、GEPT 中高級、多益 700+）',
};

function buildPrompt(difficulty: string): string {
  const diffLabel = DIFF_LABELS[difficulty] ?? DIFF_LABELS.medium;
  return `你是台灣英語老師,看到這張照片,請辨識畫面中可教給學生的英文單字。

難度:${diffLabel}

規則:
1. 從照片可見的「具體物件」「動作」「場景特徵」中挑選單字,最多 20 個
2. 每個單字提供:英文拼寫、繁體中文意思(簡潔、2-8 字)、一個例句(英文短句,盡量 ≤ 12 字)
3. 英文單字一律小寫(除非是專有名詞)
4. 中文意思以一般教科書常用翻譯為準
5. 同一物件不要重複出現(例如有多個 "book" 不要列兩次)
6. 只回傳合法 JSON,不要任何 markdown 或說明文字
7. 若照片內物件過少或無法辨識,回傳 "words" 為空陣列
8. JSON 格式:
{
  "title": "根據照片場景命名的單字表標題(≤ 20 字,例如「教室常見物品」「廚房用具」)",
  "words": [
    { "english": "desk", "chinese": "書桌", "example": "I sit at my desk." }
  ]
}`;
}

async function generateWithGemini(image: { mimeType: string; base64: string }, prompt: string): Promise<string> {
  if (!genAI) {
    throw new Error('GEMINI_API_KEY_MISSING');
  }
  const response = await callWithRetry(() =>
    genAI.models.generateContent({
      model: GEMINI_MODEL_NAME,
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: image.mimeType, data: image.base64 } },
          { text: prompt },
        ],
      }],
      config: {
        maxOutputTokens: 4096,
        temperature: 0.4,
        responseMimeType: 'application/json',
      },
    }));
  return response.text ?? '';
}

async function generateWithClaude(image: { mimeType: string; base64: string }, prompt: string): Promise<string> {
  if (!anthropic) {
    throw new Error('ANTHROPIC_API_KEY_MISSING');
  }
  const message = await callWithRetry(() =>
    anthropic.messages.create({
      model: CLAUDE_MODEL_NAME,
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: image.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
              data: image.base64,
            },
          },
          { type: 'text', text: prompt },
        ],
      }],
    }));
  return (message.content[0] as { type: string; text: string }).text ?? '';
}

type VocabResult = {
  title: string;
  words: { english: string; chinese: string; example?: string }[];
};

function parseResult(raw: string): VocabResult | null {
  try {
    // Gemini JSON mode 直接回 JSON;Claude 有時包多餘文字,regex 提取保險
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }
    const obj = JSON.parse(jsonMatch[0]);
    if (typeof obj.title !== 'string' || !Array.isArray(obj.words)) {
      return null;
    }
    const words = obj.words
      .filter((w: Record<string, unknown>) => typeof w.english === 'string' && typeof w.chinese === 'string')
      .map((w: Record<string, unknown>) => ({
        english: String(w.english).toLowerCase().trim(),
        chinese: String(w.chinese).trim(),
        example: typeof w.example === 'string' ? String(w.example).trim() : undefined,
      }));
    return { title: String(obj.title).trim(), words };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  // 配額檢查（與 generate-vocab 一致）
  const quota = await checkAndIncrementAiUsage(userId);
  if (!quota.allowed) {
    return NextResponse.json(
      { error: quota.reason, upgradeRequired: true, remaining: 0 },
      { status: 403 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: '無法解析上傳資料' }, { status: 400 });
  }

  const file = formData.get('image');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '請上傳照片' }, { status: 400 });
  }

  // 限制 5MB(client 端會壓縮到 ~1MB,server 端再保險)
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: '圖檔過大,請壓縮後再上傳(<5MB)' }, { status: 400 });
  }

  const mimeType = file.type || 'image/jpeg';
  if (!mimeType.startsWith('image/')) {
    return NextResponse.json({ error: '不支援的檔案格式' }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  const difficulty = String(formData.get('difficulty') ?? 'medium');
  const prompt = buildPrompt(difficulty);

  // Gemini 優先,失敗 fallback Claude
  let raw = '';
  let usedModel: 'gemini' | 'claude' = 'gemini';
  try {
    raw = await generateWithGemini({ mimeType, base64 }, prompt);
  } catch (geminiErr) {
    console.warn('[generate-vocab-from-image] Gemini 失敗,fallback Claude:', geminiErr);
    try {
      raw = await generateWithClaude({ mimeType, base64 }, prompt);
      usedModel = 'claude';
    } catch (claudeErr) {
      console.error('[generate-vocab-from-image] Claude fallback 也失敗:', claudeErr);
      return NextResponse.json({ error: 'AI 服務暫時無法使用' }, { status: 503 });
    }
  }

  const parsed = parseResult(raw);
  if (!parsed || parsed.words.length === 0) {
    console.warn(`[generate-vocab-from-image] ${usedModel} 回傳無有效單字:`, raw.slice(0, 300));
    return NextResponse.json(
      { error: '無法從照片辨識足夠的物件,請換張對焦清楚、物件較多的照片' },
      { status: 400 },
    );
  }

  return NextResponse.json(parsed);
}
