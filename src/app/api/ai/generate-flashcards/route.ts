export const runtime = 'nodejs';
export const maxDuration = 60;

import Anthropic from '@anthropic-ai/sdk';
import { auth } from '@clerk/nextjs/server';
import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

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

const SYSTEM_PROMPT = `你是一位專業的語言教學專家。根據使用者提供的單字清單，為每個單字生成快閃卡片。

每張卡片必須包含：
- front: 單字本身（原文）
- back: 中文解釋（簡短明確）
- example: 一個簡短的例句（使用該單字）
- phonetic: 音標或注音（英文用 KK 音標，中文用注音）

回覆格式為 JSON 陣列：
[
  {
    "front": "apple",
    "back": "蘋果",
    "example": "I eat an apple every day.",
    "phonetic": "/ˈæp.əl/"
  }
]

注意事項：
- 只回覆 JSON 陣列，不要加其他文字
- 解釋要精簡，適合學生記憶
- 例句要簡短自然
- 如果是中文單字，音標用注音符號`;

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '請先登入' }, { status: 401 });
  }

  const body = await request.json();
  const { words } = body as { words: string };

  if (!words || words.trim().length === 0) {
    return NextResponse.json({ error: '請輸入單字清單' }, { status: 400 });
  }

  const userPrompt = `請為以下單字生成快閃卡片：\n\n${words.trim()}`;

  // Gemini 優先，失敗 fallback Claude
  try {
    const result = await gemini.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: userPrompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.3,
      },
    });

    const text = result.text ?? '';
    const cards = parseCards(text);
    if (cards.length > 0) {
      return NextResponse.json({ cards });
    }
  } catch (err) {
    if (!isOverloadError(err)) {
      console.error('[generate-flashcards] Gemini error:', err);
    }
  }

  // Fallback: Claude
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = msg.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const cards = parseCards(text);
    if (cards.length > 0) {
      return NextResponse.json({ cards });
    }

    return NextResponse.json({ error: 'AI 無法生成卡片，請調整輸入內容' }, { status: 500 });
  } catch (err) {
    console.error('[generate-flashcards] Claude error:', err);
    return NextResponse.json({ error: 'AI 服務暫時無法使用' }, { status: 503 });
  }
}

function parseCards(text: string): Array<{ front: string; back: string; example: string; phonetic: string }> {
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const arr = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (c: Record<string, unknown>) => typeof c.front === 'string' && typeof c.back === 'string',
    ).map((c: Record<string, unknown>) => ({
      front: String(c.front),
      back: String(c.back),
      example: String(c.example ?? ''),
      phonetic: String(c.phonetic ?? ''),
    }));
  } catch {
    return [];
  }
}
