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
  const { topic, types = ['mc'], difficulty = 'medium', framework } = body;
  const hasListening = (types as string[]).includes('listening');
  const count = Math.min(Number(body.count) || 5, hasListening ? 5 : 20);

  if (!topic?.trim()) {
    return NextResponse.json({ error: '請輸入主題或內容' }, { status: 400 });
  }

  // 命題框架白名單 + prompt prefix 對應表（key → prefix）
  // 用 key 機制，避免 client 直接傳中文字串到 prompt 形成 injection
  const make108Prefix = (subject: string) => `你正在為台灣 108 課綱「${subject}」科目命題。
請依 108 課綱核心素養精神出題，強調：
- 情境化（題目連結真實生活或學科應用情境）
- 跨領域思考（鼓勵整合運用知識）
- 素養導向（避免單純背誦記憶）

`;
  const FRAMEWORK_PROMPTS: Record<string, string> = {
    // 108 課綱素養 — 國中
    '108-jhs-math': make108Prefix('國中數學'),
    '108-jhs-chinese': make108Prefix('國中國文'),
    '108-jhs-social': make108Prefix('國中社會'),
    '108-jhs-science': make108Prefix('國中自然'),
    '108-jhs-english': make108Prefix('國中英文'),
    '108-jhs-history': make108Prefix('國中歷史'),
    // 108 課綱素養 — 高中
    '108-shs-math': make108Prefix('高中數學'),
    '108-shs-chinese': make108Prefix('高中國文'),
    '108-shs-english': make108Prefix('高中英文'),
    '108-shs-history': make108Prefix('高中歷史'),
    '108-shs-geography': make108Prefix('高中地理'),
    '108-shs-science': make108Prefix('高中自然'),
    // PISA 國際素養
    pisa: `請以 PISA 國際學生能力評量風格出題：
- 題幹必須連結真實生活情境（社會議題、科學現象、數據資料）
- 強調閱讀理解、資料判讀、推理應用
- 跨領域整合，不限單一學科知識
- 鼓勵題幹提供圖表、文章、對話片段作為資訊源（用文字清楚描述）

`,
    // 國中教育會考
    'jhs-exam': `請以台灣國中教育會考題型風格出題：
- 以五選一單選題為主，題幹簡短清楚
- 避免艱澀字詞與冷僻知識點
- 難度均勻分佈（基礎、中等、進階各約 1/3）
- 重視基礎概念辨析與應用，貼近 108 課綱範圍

`,
    // Bloom 認知層次
    'bloom-remember': `請依 Bloom 認知層次「記憶」（Remember）出題：聚焦事實回憶、定義辨識、基本術語回想，題幹常以「下列何者為...」「...的定義是」等形式為主。

`,
    'bloom-understand': `請依 Bloom 認知層次「理解」（Understand）出題：聚焦概念解釋、舉例說明、分類比較、用自己的話複述意義，避免單純背誦。

`,
    'bloom-apply': `請依 Bloom 認知層次「應用」（Apply）出題：聚焦在新情境中運用學過的規則、方法、技巧解題，題幹常給「給定情境，請用 X 方法計算 / 解決」。

`,
    'bloom-analyze': `請依 Bloom 認知層次「分析」（Analyze）出題：聚焦拆解結構、辨別組成元素間關係、區分論點與證據、找出隱含假設。

`,
    'bloom-evaluate': `請依 Bloom 認知層次「評鑑」（Evaluate）出題：聚焦判斷優劣、批判論證、比較不同方案，要求學生支持立場並提供理由。

`,
    'bloom-create': `請依 Bloom 認知層次「創造」（Create）出題：聚焦組合元素產出新方案、設計、計畫；題型優先使用簡答題（short）讓學生開放回答。

`,
    // CEFR 英文分級
    'cefr-a1': `請以 CEFR A1（入門）等級出英文題：
- 字彙限基礎日常（家庭、學校、食物、數字、顏色）
- 文法限現在簡單式、be 動詞、簡單問答（who/what/where）
- 題幹與選項使用最簡單英文，避免複雜句構

`,
    'cefr-a2': `請以 CEFR A2（基礎）等級出英文題：
- 字彙為日常生活範圍（旅行、購物、興趣、時間）
- 文法包含現在簡單 / 進行式、過去簡單式、簡單未來式
- 短文 / 對話形式，題幹中等長度

`,
    'cefr-b1': `請以 CEFR B1（中級）等級出英文題：
- 主題：個人經驗、工作學業、旅遊計畫、簡單議題
- 文法：現在完成式、條件句（if）、被動語態入門
- 中等長度文章閱讀，學測模擬難度

`,
    'cefr-b2': `請以 CEFR B2（中高級）等級出英文題：
- 主題：抽象概念、新聞時事、專業議題
- 文法：複雜時態、被動語態、各類子句、虛擬語氣
- 長句與長篇閱讀，接近學測 / 分科測驗難度

`,
  };

  // 白名單檢查：找不到 key 視為未指定，prompt 完全不變
  const frameworkPrefix = (typeof framework === 'string' && FRAMEWORK_PROMPTS[framework]) || '';

  const diffLabel = DIFF_LABELS[difficulty] ?? '中等';
  const typesPrompt = (types as string[])
    .map(t => `- ${TYPE_LABELS[t] ?? t}，共 ${count} 題`)
    .join('\n');

  const prompt = `${frameworkPrefix}你是台灣高中的出題專家，請根據以下主題或課文內容出題。

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
- 【口語化手法】listeningText 必須像真人說話，自然穿插語氣詞（欸、嗯、啊、對、那個、然後），允許短停頓（用「，」或「…」表示），避免書面語如「由於／因此／然而／此外」，改用口語連接詞（所以、結果、可是、不過）
- 【情境多樣化】從以下情境隨機挑選，不要每題都是學生對話：
  1. 雙人對話（朋友／家人／師生／同事／店員與客人）
  2. 校園廣播、店家或車站公告（單人敘述）
  3. 電話留言、語音訊息（第一人稱）
  4. 新聞、天氣、活動介紹（主播式敘述）
- 【干擾選項設計】4 個選項中，至少 1 個干擾項必須是「listeningText 中有出現但不是正確答案」的字詞或數字，避免學生憑印象隨便選就對，提高鑑別度
- 【字數分級】
  - 簡單：選項 ≤8 字、listeningText ≤50 字
  - 中等：選項 ≤15 字、listeningText ≤100 字
  - 困難：選項不限、listeningText ≤200 字`;

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

  // 後處理：確保聽力題 type 正確（有些模型會回傳 mc 而非 listening）
  if (hasListening && result.questions) {
    const requestedTypes = new Set(types as string[]);
    for (const q of result.questions) {
      if (q.listeningText && q.type !== 'listening') {
        q.type = 'listening';
      }
      if (requestedTypes.size === 1 && requestedTypes.has('listening') && q.type === 'mc') {
        q.type = 'listening';
      }
    }
  }

  return NextResponse.json(result);
}
