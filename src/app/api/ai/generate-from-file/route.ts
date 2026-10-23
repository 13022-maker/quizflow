// pdf-lib、Buffer 是 Node.js 專屬 API，必須明確指定 Node.js Runtime
import { Buffer } from 'node:buffer';

import Anthropic from '@anthropic-ai/sdk';
import { auth } from '@clerk/nextjs/server';
import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

import { checkAndIncrementAiUsage } from '@/actions/aiUsageActions';
import { withAiUsageRefund } from '@/lib/ai/aiUsageRefund';
import { attachDiagramSvgs } from '@/lib/ai/diagramSvg';
import {
  AIOutputError,
  claudeStopReasonError,
  EMPTY_CONTENT_MESSAGE,
  geminiFinishReasonError,
  parseTypesField,
  validateGeneratedQuestions,
} from '@/lib/ai/fileQuizOutput';
import { buildPageHintPrompt, PdfPreprocessError, preparePdfForAI } from '@/lib/ai/pdfPreprocess';
import { isProSafe } from '@/lib/ai/textModel';

export const runtime = 'nodejs';
// 注意：PDF 出題實測常接近 60 秒；是否調高要看 Vercel 方案上限，這次刻意不動
export const maxDuration = 60;

// Claude Sonnet 輸出上限：20 題 × 多題型（含聽力 listeningText、圖解 diagram）
// 4096 會截斷；16384 與 Gemini maxOutputTokens 對齊
const CLAUDE_MAX_TOKENS = 16384;

type ModelChoice = 'gemini' | 'claude';
const DEFAULT_MODEL: ModelChoice = 'gemini';

const GEMINI_MODEL_NAME = 'gemini-2.5-flash';
const CLAUDE_MODEL_NAME = 'claude-sonnet-4-6';

// 判斷伺服器端是否已配置對應 API 金鑰
const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY?.trim());
const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

// 兩個 SDK 實例在 module 層級建立，避免每次請求重建
// GEMINI_API_KEY 未設定時不建立 Gemini 實例，避免 SDK 帶空 key 呼叫 Google API 出現 403
const genAI = hasGeminiKey
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })
  : null;
const anthropic = hasAnthropicKey ? new Anthropic() : null;

// 過載 / 限流自動重試，最多 3 次遞增 backoff
async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number; code?: number }).status
        ?? (err as { code?: number }).code;
      // Anthropic 529、Gemini 429 / 5xx 都視為可重試
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

// 一份多模態素材：mimeType + base64
type Media = { mimeType: string; base64: string };

// 呼叫 Gemini 2.5 Flash（省錢快速、多模態品質佳）
// 支援多份 media（例如多張照片一次出題）
async function generateWithGemini(
  media: Media[],
  prompt: string,
): Promise<string> {
  if (!genAI) {
    throw new Error('GEMINI_API_KEY_MISSING');
  }
  const response = await callWithRetry(() =>
    genAI.models.generateContent({
      model: GEMINI_MODEL_NAME,
      contents: [
        {
          role: 'user',
          parts: [
            ...media.map(m => ({ inlineData: { mimeType: m.mimeType, data: m.base64 } })),
            { text: prompt },
          ],
        },
      ],
      // 關掉 thinking 讓 100% token 給 JSON；上限提到 16384 防長題（含聽力 listeningText）截斷
      config: {
        maxOutputTokens: 16384,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    }));

  // finishReason 非 STOP：MAX_TOKENS（截斷）/ RECITATION（照抄原文）/ SAFETY（安全過濾）
  // 各自對應老師看得懂的訊息（AIOutputError.userMessage），外層會先試 Claude 重出
  const finishReason = response.candidates?.[0]?.finishReason;
  const outputError = geminiFinishReasonError(finishReason);
  if (outputError) {
    console.warn(`[generate-from-file] Gemini finishReason=${finishReason}（${(response.text ?? '').length} 字）`);
    throw outputError;
  }
  return response.text ?? '';
}

// 呼叫 Claude Sonnet 4（品質優、適合複雜題目）
// 支援多份 media（多張圖片）；PDF / document 仍維持單份
async function generateWithClaude(
  media: Media[],
  prompt: string,
): Promise<string> {
  if (!anthropic) {
    throw new Error('ANTHROPIC_API_KEY_MISSING');
  }
  // Claude 多模態格式 — image / document 分開；支援多份 media
  const content: Anthropic.MessageParam['content'] = [
    ...media.map((m): Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam =>
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
    ),
    { type: 'text', text: prompt },
  ];

  // 串流聚合（比照 textModel.callClaude）：max_tokens 拉高後輸出時間變長，避免撞 HTTP 逾時
  const message = await callWithRetry(() =>
    anthropic.messages.stream({
      model: CLAUDE_MODEL_NAME,
      max_tokens: CLAUDE_MAX_TOKENS,
      messages: [{ role: 'user', content }],
    }).finalMessage());

  // 過去沒檢查 stop_reason：截斷的半截 JSON 只會變成籠統的「AI 回傳格式錯誤」
  const outputError = claudeStopReasonError(message.stop_reason);
  if (outputError) {
    console.warn(`[generate-from-file] Claude stop_reason=${message.stop_reason}`);
    throw outputError;
  }

  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');
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
  cloze: '克漏字題（80-150 字短文，挑 3-5 個關鍵詞彙用 [[詞彙]] 標記挖空，question 欄位放整段含標記的文章，不需要 answer 欄位）',
  listening: '聽力題（type 為 "listening"，4選1，額外提供 listeningText 欄位存放要念的口語化對話或短文）',
};

// JSON 格式範例：只放老師勾選的題型，避免 AI 看到範例裡有的題型就自動多生一題
// （踩過的坑：範例陣列本來不管勾選什麼都列出全部題型，AI 常常照抄範例多生出沒勾選的聽力題）
const TYPE_EXAMPLES: Record<string, string> = {
  mc: '    { "type": "mc", "question": "題目", "options": ["(A)..","(B)..","(C)..","(D).."], "answer": "A", "explanation": "說明" }',
  tf: '    { "type": "tf", "question": "敘述句題目", "answer": "○", "explanation": "說明" }',
  fill: '    { "type": "fill", "question": "含 ___ 的題目", "answer": "答案", "explanation": "" }',
  short: '    { "type": "short", "question": "簡答題目", "answer": "參考答案", "explanation": "" }',
  rank: '    { "type": "rank", "question": "請依時間先後排列下列事件", "options": ["文藝復興","工業革命","二次大戰","網際網路誕生"], "answer": ["文藝復興","工業革命","二次大戰","網際網路誕生"], "explanation": "說明" }',
  cloze: '    { "type": "cloze", "question": "光合作用是植物利用[[葉綠素]]吸收[[陽光]]，將二氧化碳和水轉化成養分與氧氣的過程。", "explanation": "說明" }',
  listening: '    { "type": "listening", "question": "根據內容，以下哪個說法正確？", "options": ["(A)..","(B)..","(C)..","(D).."], "answer": "A", "explanation": "說明", "listeningText": "根據文件內容改寫成口語化的朗讀文字，作為學生聽力素材" }',
};

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  // 檢查 AI 出題 quota（先扣次以便及早擋掉超額用戶；之後任何失敗回應都會自動退還）
  const quota = await checkAndIncrementAiUsage(userId);
  if (!quota.allowed) {
    return NextResponse.json(
      { error: quota.reason, upgradeRequired: true, remaining: 0 },
      { status: 403 },
    );
  }

  return withAiUsageRefund(userId, quota, () => handleGenerate(request));
}

async function handleGenerate(request: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: '上傳資料格式錯誤，請重新上傳' }, { status: 400 });
  }
  // 支援單檔（PDF / 音檔）與多檔（多張圖片）
  const uploaded = formData.getAll('file').filter((v): v is File => v instanceof File);
  const rawCount = Number.parseInt(formData.get('count') as string) || 5;
  // 過去 JSON.parse 在 try 外面，格式錯誤直接 500
  const typesResult = parseTypesField(formData.get('types') as string | null);
  if (!typesResult.ok) {
    return NextResponse.json({ error: typesResult.error }, { status: 400 });
  }
  const types: string[] = typesResult.types;
  const hasListening = types.includes('listening');
  const count = Math.min(rawCount, hasListening ? 5 : 20);
  const difficulty = (formData.get('difficulty') as string) || 'medium';
  const startPage = Number.parseInt(formData.get('startPage') as string) || 1;
  const endPage = Number.parseInt(formData.get('endPage') as string) || 0;

  // 使用者選的模型（'gemini' | 'claude'），預設 gemini
  const modelRaw = (formData.get('model') as string) || DEFAULT_MODEL;
  const model: ModelChoice = modelRaw === 'claude' ? 'claude' : 'gemini';

  if (uploaded.length === 0) {
    return NextResponse.json({ error: '請上傳檔案' }, { status: 400 });
  }

  const IMAGE_EXT_SET = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
  const AUDIO_EXT_SET = new Set(['mp3', 'wav', 'm4a', 'ogg', 'webm', 'aac', 'flac']);

  const getExt = (f: File) => f.name.split('.').pop()?.toLowerCase() ?? '';
  const isAudioFile = (f: File) =>
    AUDIO_EXT_SET.has(getExt(f)) || f.type.startsWith('audio/');

  const firstFile = uploaded[0]!;
  const firstExt = getExt(firstFile);
  const isImage = IMAGE_EXT_SET.has(firstExt);
  const isPDF = firstExt === 'pdf';
  const isAudio = isAudioFile(firstFile);

  if (!isImage && !isPDF && !isAudio) {
    return NextResponse.json(
      { error: '支援 PDF、圖片、音檔格式。Word 請另存 PDF 後上傳' },
      { status: 400 },
    );
  }

  // 多檔只允許全部都是圖片；PDF / 音檔僅處理第一個
  if (uploaded.length > 1 && !uploaded.every(f => IMAGE_EXT_SET.has(getExt(f)))) {
    return NextResponse.json(
      { error: '多檔上傳僅支援圖片格式（PDF / 音檔請單檔上傳）' },
      { status: 400 },
    );
  }

  const diffLabel = DIFF_LABELS[difficulty] || '中等';
  const typesPrompt = types.map(t => `- ${TYPE_LABELS[t]}，共 ${count} 題`).join('\n');
  // 只放老師勾選的題型範例；沒勾選的題型完全不出現在 prompt 裡（防呆：空陣列退回 mc 範例）
  const questionsExample = types
    .map(t => TYPE_EXAMPLES[t])
    .filter(Boolean)
    .join(',\n') || TYPE_EXAMPLES.mc;

  // 音檔用聽力題專用 prompt，文件 / 圖片用一般 prompt
  // let：加密 PDF 無法裁切時，下面會再附上「只根據第 X–Y 頁」的限定句
  let prompt = isAudio
    ? `請聽取以上音檔內容，根據音檔生成聽力測驗題。

難度：${diffLabel}
每種題型各出 ${count} 題，所有文字使用繁體中文。

規則：
1. 所有題目必須根據音檔的實際內容出題，不可自行捏造
2. 只回傳合法 JSON，不要 markdown 或任何說明文字
3. 每題都是聽力選擇題（type 一律為 "listening"）
4. 【干擾選項設計】4 個選項中，至少 1 個干擾項必須是「音檔中有出現但不是正確答案」的字詞、數字或人名，避免學生憑印象聽到關鍵字就選對，提高鑑別度
5. 【字數分級】簡單難度選項 ≤8 字、中等 ≤15 字、困難不限
6. JSON 格式：
{
  "title": "根據音檔內容命名的聽力測驗標題",
  "transcript": "音檔的完整逐字稿（繁體中文）",
  "questions": [
    { "type": "listening", "question": "根據音檔，以下哪個說法正確？", "options": ["(A)..","(B)..","(C)..","(D).."], "answer": "A", "explanation": "說明" }
  ]
}
7. 正確答案（A/B/C/D）位置務必平均分散在四個字母之間，不要讓多題答案集中在同一個字母
8. 若音檔沒有可辨識的語音內容或內容太少不足以出題，不要捏造題目，直接回傳 { "title": "", "transcript": "", "questions": [] }`
    : `請根據以上文件內容出題。

難度：${diffLabel}
出題類型：
${typesPrompt}

規則：
1. 所有題目必須根據文件的實際內容，不可自行捏造
2. 只回傳合法 JSON，不要 markdown 或任何說明文字
3. 數學與科學符號只能使用 Unicode（如 π √ ² ³ ½ ≤ ≥ × ÷ ± ∞ ≠ ≈ ∑ ∫），禁止使用 LaTeX 語法（例如 \\frac、\\sqrt、\\int、$...$）
4. 分數寫作 1/2、2/3，不寫 $\\frac{...}{...}$
5. 次方寫作 x²、x³、x⁴；三次方以上可用 x^n（例如 x^10）
6. 根號寫作 √2、√(a+b)；不寫 \\sqrt
7. 微積分符號 ∫、∑、∞、lim 直接使用 Unicode
8. 題目必須能只靠文字作答：禁止出「如下圖所示」「如圖」「參考附表」這類需要看到文件中的圖片、圖表或表格才能作答的題目（學生端看不到原始文件的圖）；若概念來自圖表，請把圖表中的關鍵資訊直接寫進題幹
9. 若文件內容空白、無法辨識（例如掃描不清）或內容太少不足以出題，不要硬湊或捏造題目，直接回傳 { "title": "", "questions": [] }
10. 若文件內容本身是選擇題格式（含①②③④或 A/B/C/D 等選項標號），出「填空題」時請將題幹與正確選項的文字內容重組成一句完整敘述句，把關鍵詞彙或答案內容挖空（用 ___ 標示），answer 填正確選項的實際文字內容；不要照抄原本的①②③④符號，也不要整段原封不動照搬選擇題格式
11. JSON 格式（下面範例只列出本次勾選的題型，只能輸出這些題型，不可額外生成範例以外的題型）：
{
  "title": "根據文件內容自動命名的試卷標題",
  "questions": [
${questionsExample}
  ]
}
每種題型各出 ${count} 題，只出勾選的題型。
${hasListening ? '單選題（mc）與聽力題（listening）' : '單選題（mc）'}的正確答案（A/B/C/D）位置務必平均分散在四個字母之間，不要讓多題答案集中在同一個字母（尤其避免全部落在 A 或 C）。${hasListening
  ? `
聽力題特別注意：
- type 必須為 "listening"
- 必須提供 listeningText 欄位：根據文件內容改寫成口語化的短文或對話，模擬真實聽力情境
- listeningText 控制在 50-200 字`
  : ''}

若某題(限選擇題 mc、是非題 tf、填空題 fill)的內容適合用圖表輔助理解（流程步驟、兩者比較、時間先後、概念之間的關係），在該題 JSON 加一個 "diagram" 欄位，格式為以下 4 種之一（不適合就完全不要加這個欄位，不是每題都需要圖，大部分題目不需要）：
- 流程：{"type":"flow","steps":["步驟1","步驟2",...]}（2-6 步）
- 比較：{"type":"compare","leftTitle":"...","leftPoints":["..."],"rightTitle":"...","rightPoints":["..."]}（每欄 1-5 點）
- 時間軸：{"type":"timeline","events":[{"label":"...","note":"..."}]}（2-6 個事件，note 可省略）
- 概念關係：{"type":"concept","nodes":["A","B",...],"edges":[{"from":"A","to":"B","label":"..."}]}（2-6 節點，最多 8 條關係，label 可省略）
（每個文字欄位——步驟、標題、要點、標籤、節點名稱——請控制在 8 個字以內，避免版面擠爆或文字重疊）`;

  const imageMimeMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
  };

  const audioMimeMap: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    ogg: 'audio/ogg',
    webm: 'audio/webm',
    aac: 'audio/aac',
    flac: 'audio/flac',
  };

  // 先處理檔案（老師可自行修正的錯誤，如損毀 / 加密 PDF、頁數範圍）再檢查伺服器金鑰
  const media: { mimeType: string; base64: string }[] = [];

  if (isAudio) {
    const arrayBuffer = await firstFile.arrayBuffer();
    media.push({
      mimeType: audioMimeMap[firstExt] || firstFile.type || 'audio/mpeg',
      base64: Buffer.from(arrayBuffer).toString('base64'),
    });
  } else if (isImage) {
    // 多張圖片一起送
    for (const f of uploaded) {
      const e = getExt(f);
      const buf = await f.arrayBuffer();
      media.push({
        mimeType: imageMimeMap[e] || 'image/png',
        base64: Buffer.from(buf).toString('base64'),
      });
    }
  } else {
    // PDF：一律用伺服器端量到的真實頁數判斷上限，不信任前端傳來的 startPage/endPage
    // （見 src/libs/pdfPageLimit.ts）。加密 PDF 不能用 pdf-lib copyPages 裁切——
    // 那樣會產生內容全是密文亂碼的 PDF，改送原始 bytes（詳見 src/lib/ai/pdfPreprocess.ts）。
    try {
      const prepared = await preparePdfForAI(new Uint8Array(await firstFile.arrayBuffer()), { startPage, endPage });
      media.push({
        mimeType: 'application/pdf',
        base64: Buffer.from(prepared.bytes).toString('base64'),
      });
      prompt += buildPageHintPrompt(prepared.pageHint);
    } catch (err) {
      if (err instanceof PdfPreprocessError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }
  }

  // 音檔只能走 Gemini（Claude 不支援音檔多模態）
  let effectiveModel: ModelChoice = isAudio ? 'gemini' : model;

  // 免費用戶選 Claude → 靜默轉 Gemini（付費者才走 Claude；UI 照舊可選，由 server 分流）
  if (effectiveModel === 'claude' && !(await isProSafe())) {
    console.warn('[generate-from-file] 非付費用戶選 Claude，靜默轉 Gemini');
    effectiveModel = 'gemini';
  }

  // 伺服器端金鑰檢查：Gemini 沒設且非音檔 → 自動改用 Claude
  if (effectiveModel === 'gemini' && !hasGeminiKey) {
    if (isAudio) {
      return NextResponse.json(
        { error: '伺服器尚未設定 GEMINI_API_KEY，無法處理音檔 / 聽力題。請改上傳 PDF 或圖片，或聯繫管理員設定金鑰。' },
        { status: 503 },
      );
    }
    if (!hasAnthropicKey) {
      return NextResponse.json(
        { error: 'AI 命題服務尚未啟用：伺服器缺少 GEMINI_API_KEY 與 ANTHROPIC_API_KEY，請聯繫管理員。' },
        { status: 503 },
      );
    }
    console.warn('[generate-from-file] GEMINI_API_KEY 未設定，自動改用 Claude');
    effectiveModel = 'claude';
  }

  if (effectiveModel === 'claude' && !hasAnthropicKey) {
    return NextResponse.json(
      { error: '伺服器尚未設定 ANTHROPIC_API_KEY，無法使用 Claude 命題。請改選 Gemini 或聯繫管理員。' },
      { status: 503 },
    );
  }

  try {
    let raw: string;
    try {
      raw = effectiveModel === 'claude'
        ? await generateWithClaude(media, prompt)
        : await generateWithGemini(media, prompt);
    } catch (err) {
      if (err instanceof AIOutputError && effectiveModel === 'gemini' && hasAnthropicKey && !isAudio) {
        // Gemini 輸出不可用（截斷 / 照抄 / 安全過濾）自動 fallback Claude 重出
        // （音檔 Claude 不支援；Claude 也失敗時，丟出的是 Claude 的 AIOutputError 或 API 錯誤）
        raw = await generateWithClaude(media, prompt);
      } else if (effectiveModel === 'claude' && hasGeminiKey && !isAudio) {
        // Claude 失敗（額度不足/過載等）→ fallback Gemini（音檔本來就只走 Gemini，不會進這裡）
        console.warn('[generate-from-file] Claude 失敗，fallback Gemini：', err instanceof Error ? err.message : err);
        raw = await generateWithGemini(media, prompt);
      } else {
        throw err;
      }
    }

    // Gemini JSON mode 通常直接回乾淨 JSON；Claude 有時包多餘文字，regex 提取保險
    const match = raw.match(/\{[\s\S]*\}/);
    const jsonText = match ? match[0] : raw;

    let result;
    try {
      result = JSON.parse(jsonText);
    } catch {
      console.error(`[generate-from-file] ${effectiveModel} 回傳非 JSON：`, raw.slice(0, 500));
      return NextResponse.json({ error: 'AI 回傳格式錯誤，請重試' }, { status: 500 });
    }
    if (!result || typeof result !== 'object' || !Array.isArray(result.questions)) {
      console.error(`[generate-from-file] ${effectiveModel} 回傳 JSON 缺 questions 陣列：`, raw.slice(0, 500));
      return NextResponse.json({ error: 'AI 回傳格式錯誤，請重試' }, { status: 500 });
    }
    // AI 判斷內容不足（空白頁 / 掃描不清）時依 prompt 規則回空陣列
    if (result.questions.length === 0) {
      return NextResponse.json({ error: EMPTY_CONTENT_MESSAGE }, { status: 422 });
    }

    // 後處理：確保聽力題 type 正確（AI 可能回傳 mc 而非 listening）
    if (hasListening && result.questions) {
      const requestedTypes = new Set(types);
      for (const q of result.questions) {
        if (q.listeningText && q.type !== 'listening') {
          q.type = 'listening';
        }
        if (requestedTypes.has('listening') && q.type === 'mc' && !requestedTypes.has('mc')) {
          q.type = 'listening';
        }
      }
    }

    // 剔除不完整的題目（缺題幹、選項不足、缺答案），選擇題答案「(A)」「A.」正規化成「A」
    const { questions: validQuestions, dropped } = validateGeneratedQuestions(result.questions);
    if (dropped > 0) {
      console.warn(`[generate-from-file] ${effectiveModel} 有 ${dropped} 題格式不完整已剔除`);
    }
    if (validQuestions.length === 0) {
      return NextResponse.json({ error: 'AI 產生的題目格式都不完整，請重試' }, { status: 500 });
    }

    // 圖解:mc/tf/fill 題型若 AI 判斷需要,附上 diagramSvg(fail-open,失敗就不附圖)
    attachDiagramSvgs(validQuestions);

    // dropped 是新增欄位（additive），其餘回應形狀不變
    return NextResponse.json({ ...result, questions: validQuestions, dropped });
  } catch (err) {
    // 截斷 / 照抄原文 / 安全過濾：給可行動的中文訊息，不外洩內部 sentinel
    if (err instanceof AIOutputError) {
      console.warn(`[generate-from-file] ${effectiveModel} 輸出不可用：${err.rawReason}`);
      return NextResponse.json({ error: err.userMessage }, { status: 422 });
    }
    const status = (err as { status?: number; code?: number }).status
      ?? (err as { code?: number }).code;
    const overloaded
      = status === 429
      || status === 529
      || (typeof status === 'number' && status >= 500)
      || (err instanceof Error && err.message.includes('overloaded'));
    if (overloaded) {
      return NextResponse.json(
        { error: 'AI 伺服器目前忙碌，請稍後再試', retryable: true },
        { status: 503 },
      );
    }

    const msg = err instanceof Error ? err.message : '未知錯誤';

    // 金鑰未設定（generateWithGemini / generateWithClaude 丟出）
    if (msg === 'GEMINI_API_KEY_MISSING') {
      return NextResponse.json(
        { error: '伺服器尚未設定 GEMINI_API_KEY，AI 命題暫時無法使用。請聯繫管理員。' },
        { status: 503 },
      );
    }
    if (msg === 'ANTHROPIC_API_KEY_MISSING') {
      return NextResponse.json(
        { error: '伺服器尚未設定 ANTHROPIC_API_KEY，AI 命題暫時無法使用。請聯繫管理員。' },
        { status: 503 },
      );
    }

    // Google API 未授權（金鑰無效 / 被撤銷 / 帳單未啟用）
    const permissionDenied
      = status === 403
      || msg.includes('PERMISSION_DENIED')
      || msg.includes('unregistered callers')
      || msg.includes('API key not valid');
    if (permissionDenied) {
      return NextResponse.json(
        { error: 'AI 金鑰驗證失敗：伺服器的 GEMINI_API_KEY 無效或未授權此 API，請聯繫管理員檢查設定。' },
        { status: 503 },
      );
    }

    console.error(`[generate-from-file] ${effectiveModel} 呼叫失敗：`, err);
    return NextResponse.json({ error: `AI 命題失敗：${msg}` }, { status: 500 });
  }
}
