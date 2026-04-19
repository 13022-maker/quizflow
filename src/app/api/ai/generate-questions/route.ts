/**
 * 文字主題出題 API
 * 主用 Gemini 2.5 Flash（免費），Gemini 過載時自動 fallback 到 OpenAI GPT-4o
 */

import { auth } from '@clerk/nextjs/server';
import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

import { checkAndIncrementAiUsage } from '@/actions/aiUsageActions';

export const runtime = 'nodejs';
export const maxDuration = 60;

const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });

// 判斷是否為過載 / 限流錯誤
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
  easy: '簡單（基礎記憶型）',
  medium: '中等（理解應用型）',
  hard: '困難（分析評估型）',
};

const TYPE_LABELS: Record<string, string> = {
  mc: '選擇題（4選1，標明正確選項字母）',
  tf: '是非題（答案為「○」或「✕」）',
  fill: '填空題（用 ___ 標空格，附答案）',
  short: '簡答題（附參考答案）',
  rank: '排序題（提供 3-5 個項目，answer 為依正確順序排列的項目陣列）',
  listening: '聽力題（type 為 "listening"，4選1，額外提供 listeningText 欄位存放要念的口語化對話或短文）',
};

export async function POST(request: Request) {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  const quota = await checkAndIncrementAiUsage(orgId);
  if (!quota.allowed) {
    return NextResponse.json(
      { error: quota.reason, upgradeRequired: true, remaining: 0 },
      { status: 403 },
    );
  }

  const body = await request.json();
  const { topic, types = ['mc'], difficulty = 'medium' } = body;
  const hasListening = (types as string[]).includes('listening');
  const count = Math.min(Number(body.count) || 5, hasListening ? 5 : 20);

  if (!topic?.trim()) {
    return NextResponse.json({ error: '請輸入主題或內容' }, { status: 400 });
  }

  const diffLabel = DIFF_LABELS[difficulty] ?? '中等';
  const typesPrompt = (types as string[])
    .map(t => `- ${TYPE_LABELS[t] ?? t}，共 ${count} 題`)
    .join('\n');

  const prompt = `你是台灣高中的出題專家，請根據以下主題或課文內容出題。

主題／內容：
${topic}

難度：${diffLabel}
出題類型：
${typesPrompt}

規則：
1. 根據提供的主題或內容出題，不可自行捏造
2. 只回傳合法 JSON，不要 markdown 或任何說明文字
3. 數學與科學符號只能使用 Unicode（如 π √ ² ³ ½ ≤ ≥ × ÷ ± ∞ ≠ ≈ ∑ ∫），禁止使用 LaTeX 語法（例如 \\frac、\\sqrt、\\int、$...$）
4. 分數寫作 1/2、2/3，不寫 $\\frac{...}{...}$
5. 次方寫作 x²、x³、x⁴；三次方以上可用 x^n（例如 x^10）
6. 根號寫作 √2、√(a+b)；不寫 \\sqrt
7. 微積分符號 ∫、∑、∞、lim 直接使用 Unicode
8. JSON 格式：
{
  "title": "根據主題自動命名的試卷標題",
  "questions": [
    { "type": "mc", "question": "題目", "options": ["(A)選項一","(B)選項二","(C)選項三","(D)選項四"], "answer": "A", "explanation": "說明" },
    { "type": "tf", "question": "敘述句題目", "answer": "○", "explanation": "說明" },
    { "type": "fill", "question": "含 ___ 的題目", "answer": "答案", "explanation": "" },
    { "type": "short", "question": "簡答題目", "answer": "參考答案", "explanation": "" },
    { "type": "rank", "question": "請依時間先後排列下列事件", "options": ["文藝復興","工業革命","二次大戰","網際網路誕生"], "answer": ["文藝復興","工業革命","二次大戰","網際網路誕生"], "explanation": "說明" },
    { "type": "listening", "question": "根據對話內容，小明最後決定做什麼？", "options": ["(A)去圖書館","(B)回家寫功課","(C)去打球","(D)去吃飯"], "answer": "C", "explanation": "說明", "listeningText": "小華：嘿，小明，等一下要不要一起去打球？\\n小明：好啊！我剛好寫完功課了。" }
  ]
}
每種題型各出 ${count} 題，只出勾選的題型，所有文字使用繁體中文。
聽力題特別注意：
- listeningText 必須使用口語化的對話或短文，避免書面語，模擬真實聽力情境
- 簡單難度時：選項用最基礎的詞彙，每個選項不超過 8 個字，listeningText 控制在 50 字以內
- 中等難度時：選項可稍長但不超過 15 字，listeningText 控制在 100 字以內
- 困難難度時：選項可更複雜，listeningText 可到 200 字`;

  // 主用 Gemini，過載時 fallback Claude
  let raw: string;
  let usedModel = 'gemini';

  try {
    const response = await gemini.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { maxOutputTokens: 8192, responseMimeType: 'application/json' },
    });
    raw = response.text ?? '';
  } catch (geminiErr) {
    console.warn('[generate-questions] Gemini 失敗，fallback OpenAI：', geminiErr instanceof Error ? geminiErr.message : geminiErr);

    // Gemini 失敗 → fallback OpenAI
    console.warn('[generate-questions] Gemini 過載，fallback OpenAI');
    usedModel = 'openai';
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return NextResponse.json({ error: 'AI 備援服務未設定（缺少 OPENAI_API_KEY）' }, { status: 503 });
    }
    try {
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 8192,
          response_format: { type: 'json_object' },
        }),
      });
      if (!openaiRes.ok) {
        const errBody = await openaiRes.text();
        throw new Error(`OpenAI ${openaiRes.status}: ${errBody.slice(0, 200)}`);
      }
      const openaiData = await openaiRes.json();
      raw = openaiData.choices?.[0]?.message?.content ?? '';
    } catch (openaiErr) {
      console.error('[generate-questions] OpenAI fallback 失敗，嘗試 Claude：', openaiErr);

      // OpenAI 也失敗 → 第三備援 Claude
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) {
        const msg = openaiErr instanceof Error ? openaiErr.message : '未知錯誤';
        return NextResponse.json({ error: `AI 命題失敗：${msg}` }, { status: 500 });
      }

      usedModel = 'claude';
      try {
        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        if (!claudeRes.ok) {
          const errBody = await claudeRes.text();
          throw new Error(`Claude ${claudeRes.status}: ${errBody.slice(0, 200)}`);
        }
        const claudeData = await claudeRes.json();
        raw = claudeData.content?.[0]?.text ?? '';
      } catch (claudeErr) {
        const msg = claudeErr instanceof Error ? claudeErr.message : '未知錯誤';
        console.error('[generate-questions] Claude 第三備援也失敗：', claudeErr);
        return NextResponse.json({ error: `AI 命題失敗：${msg}` }, { status: 500 });
      }
    }
  }

  // 解析 JSON
  const match = raw.match(/\{[\s\S]*\}/);
  const jsonText = match ? match[0] : raw;

  let result;
  try {
    result = JSON.parse(jsonText);
  } catch {
    console.error(`[generate-questions] ${usedModel} 回傳非 JSON：`, raw.slice(0, 500));
    return NextResponse.json({ error: 'AI 回傳格式錯誤，請重試' }, { status: 500 });
  }

  return NextResponse.json(result);
}
