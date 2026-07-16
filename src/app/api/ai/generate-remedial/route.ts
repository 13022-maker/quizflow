import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { generateAIText } from '@/lib/ai/textModel';
import { db } from '@/libs/DB';
import { responseSchema } from '@/models/Schema';

export const runtime = 'nodejs';
export const maxDuration = 60;

type WeakPoint = {
  concept: string;
  suggestion: string;
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { weakPoints, responseId } = body as {
      weakPoints: WeakPoint[];
      responseId: number;
    };

    if (!weakPoints?.length || !responseId) {
      return NextResponse.json({ error: '缺少必要資料' }, { status: 400 });
    }

    const [resp] = await db
      .select({ id: responseSchema.id })
      .from(responseSchema)
      .where(eq(responseSchema.id, responseId))
      .limit(1);

    if (!resp) {
      return NextResponse.json({ error: '無效的作答記錄' }, { status: 403 });
    }

    const conceptList = weakPoints.map(w => `- ${w.concept}：${w.suggestion}`).join('\n');

    const prompt = `你是一位耐心的家教老師。學生剛做完一份測驗，以下是他需要加強的概念：

${conceptList}

請根據這些弱點概念，出 ${Math.min(weakPoints.length * 2, 5)} 題補強練習題。
題目要從最基礎開始，幫助學生真正理解這些概念。

規則：
1. 只出選擇題（4選1），降低學生負擔
2. 每題附上簡短解析，像家教一樣解釋為什麼
3. 題目難度比原本的測驗稍微簡單，建立信心
4. 只回傳合法 JSON，不要 markdown
5. 所有文字使用繁體中文

JSON 格式：
{
  "questions": [
    {
      "question": "題目",
      "options": ["(A) 選項一", "(B) 選項二", "(C) 選項三", "(D) 選項四"],
      "answer": "A",
      "explanation": "解析（用簡單口語解釋）",
      "targetConcept": "針對的弱點概念"
    }
  ]
}`;

    // 統一走 generateAIText：付費 Claude（失敗備援 Gemini）、免費 Gemini
    const { text: raw, usedModel } = await generateAIText({
      prompt,
      maxTokens: 2048,
      json: true,
    });
    console.warn(`[generate-remedial] usedModel=${usedModel}`);

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return NextResponse.json({ error: 'AI 回傳格式錯誤' }, { status: 500 });
    }

    const result = JSON.parse(match[0]);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '補強題生成失敗';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
