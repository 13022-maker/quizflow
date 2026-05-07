/**
 * AI 生成中英單字對 API（單字記憶模式專用）
 * 輸入：{ topic, count, difficulty }
 * 輸出：{ title, words: [{ chinese, english, example? }] }
 *
 * 主用 Gemini 2.5 Flash，過載時 fallback Claude Sonnet 4
 */

import Anthropic from '@anthropic-ai/sdk';
import { auth } from '@clerk/nextjs/server';
import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

import { checkAndIncrementAiUsage } from '@/actions/aiUsageActions';

export const runtime = 'nodejs';
export const maxDuration = 60;

const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });
const anthropic = new Anthropic();

function isOverloadError(err: unknown): boolean {
  const status = (err as { status?: number; code?: number }).status
    ?? (err as { code?: number }).code;
  const msg = err instanceof Error ? err.message : '';
  return status === 429
    || status === 503
    || status === 529
    || (typeof status === 'number' && status >= 500)
    || msg.includes('overloaded')
    || msg.includes('UNAVAILABLE')
    || msg.includes('high demand');
}

const DIFF_LABELS: Record<string, string> = {
  easy: '初級（國中基礎、日常生活）',
  medium: '中級（高中、全民英檢中級）',
  hard: '進階（學測、GEPT 中高級、多益 700+）',
};

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  const quota = await checkAndIncrementAiUsage(userId);
  if (!quota.allowed) {
    return NextResponse.json(
      { error: quota.reason, upgradeRequired: true, remaining: 0 },
      { status: 403 },
    );
  }

  const body = await request.json();
  const topic = String(body.topic ?? '').trim();
  const difficulty = String(body.difficulty ?? 'medium');
  const count = Math.min(Math.max(Number(body.count) || 15, 5), 30);

  if (!topic) {
    return NextResponse.json({ error: '請輸入單字主題' }, { status: 400 });
  }

  const diffLabel = DIFF_LABELS[difficulty] ?? DIFF_LABELS.medium;

  const prompt = `你是台灣英語老師，請根據以下主題挑選適合學生記憶的英文單字，生成中英對照清單。

主題：${topic}
難度：${diffLabel}
單字數量：${count}

規則：
1. 每個單字提供：英文拼寫、繁體中文意思（簡潔、2-8 字）、一個例句（英文短句，盡量 ≤ 12 字）
2. 避免重複單字與近義詞過度重疊
3. 英文單字一律小寫（除非是專有名詞）
4. 中文意思以一般教科書常用翻譯為準
5. 只回傳合法 JSON，不要任何 markdown 或說明文字
6. JSON 格式：
{
  "title": "根據主題命名的單字表標題（≤ 20 字）",
  "words": [
    { "english": "apple", "chinese": "蘋果", "example": "I eat an apple every day." },
    { "english": "book", "chinese": "書", "example": "She reads a book." }
  ]
}
共 ${count} 個單字，全部用繁體中文標示中文意思。`;

  let raw: string;
  let usedModel = 'gemini';

  try {
    const response = await gemini.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      // 關掉 thinking 讓 100% token 給 JSON;上限提到 16384 防長題截斷
      config: {
        maxOutputTokens: 16384,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    raw = response.text ?? '';
    // finishReason 非 STOP = 輸出被截斷,直接觸發 fallback Claude 重出
    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      console.warn(`[generate-vocab] Gemini finishReason=${finishReason}（${raw.length} 字），改走 Claude 重出`);
      throw new Error('GEMINI_TRUNCATED');
    }
  } catch (geminiErr) {
    const isTruncated = geminiErr instanceof Error && geminiErr.message === 'GEMINI_TRUNCATED';
    if (!isTruncated && !isOverloadError(geminiErr)) {
      const msg = geminiErr instanceof Error ? geminiErr.message : '未知錯誤';
      console.error('[generate-vocab] Gemini 失敗（非過載非截斷）：', geminiErr);
      return NextResponse.json({ error: `AI 生成失敗：${msg}` }, { status: 500 });
    }
    console.warn(`[generate-vocab] ${isTruncated ? 'Gemini 截斷' : 'Gemini 過載'}，fallback Claude`);
    usedModel = 'claude';
    try {
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });
      raw = (message.content[0] as { type: string; text: string }).text ?? '';
    } catch (claudeErr) {
      const msg = claudeErr instanceof Error ? claudeErr.message : '未知錯誤';
      console.error('[generate-vocab] Claude fallback 也失敗：', claudeErr);
      return NextResponse.json({ error: `AI 生成失敗：${msg}` }, { status: 500 });
    }
  }

  const match = raw.match(/\{[\s\S]*\}/);
  const jsonText = match ? match[0] : raw;

  let result: { title?: string; words?: { english: string; chinese: string; example?: string }[] };
  try {
    result = JSON.parse(jsonText);
  } catch {
    console.error(`[generate-vocab] ${usedModel} 回傳非 JSON：`, raw.slice(0, 500));
    return NextResponse.json({ error: 'AI 回傳格式錯誤，請重試' }, { status: 500 });
  }

  if (!Array.isArray(result.words) || result.words.length === 0) {
    return NextResponse.json({ error: 'AI 未回傳單字清單，請重試' }, { status: 500 });
  }

  return NextResponse.json(result);
}
