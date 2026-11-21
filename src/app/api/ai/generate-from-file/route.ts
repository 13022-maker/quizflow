// pdf-lib、Buffer 是 Node.js 專屬 API，必須明確指定 Node.js Runtime
import { Buffer } from 'node:buffer';

import Anthropic from '@anthropic-ai/sdk';
import { auth } from '@clerk/nextjs/server';
import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';

import { checkAndIncrementAiUsage } from '@/actions/aiUsageActions';
import { AI_TIMEOUT_MESSAGE, AIDeadlineError, callWithDeadline, canStartAttempt, createDeadline, type Deadline } from '@/lib/ai/aiDeadline';
import { buildCodeSnippetRule } from '@/lib/ai/codeSnippetPrompt';
import { attachDiagramSvgs } from '@/lib/ai/diagramSvg';
import { buildNoFigureReferenceRule } from '@/lib/ai/figureReferencePrompt';
import { QUIZ_MODEL_OPTIONS, type QuizModelChoice } from '@/lib/ai/quizModelOptions';
import { buildSingleAnswerRule } from '@/lib/ai/singleAnswerPrompt';
import { canUseClaude, FREE_AI_UNAVAILABLE_MESSAGE } from '@/lib/ai/textModel';
import { ensureCodeSnippets } from '@/lib/codeBlock';
import { resolvePdfPageRange } from '@/libs/pdfPageLimit';

export const runtime = 'nodejs';
// Vercel Hobby + Fluid compute 的上限是 300 秒（同 generate-subject-from-file）。
// 60 秒時 PDF 多模態出題常常剛好卡線被平台砍掉（2026-11-18 production / preview 逾時）
export const maxDuration = 300;

// 時間預算：從收到請求起算，比 maxDuration 少 30 秒，留給 JSON 後處理與回應，
// 讓 route 自己回 504 JSON，而不是被平台砍掉回非 JSON 的錯誤頁
const ROUTE_BUDGET_MS = 270_000;
// 單次 AI 呼叫上限：卡住的連線不會吃光整個預算，還能重試 / fallback
const ATTEMPT_CAP_MS = 150_000;
// 剩不到這麼多時間就不開新的一次 AI 呼叫（PDF 多模態出題很少在 20 秒內完成）
const MIN_ATTEMPT_MS = 20_000;
// 截斷 / 失敗後改走另一個模型「整份重出」至少要留的時間
const MIN_FALLBACK_MS = 45_000;

type ModelChoice = QuizModelChoice;
const DEFAULT_MODEL: ModelChoice = 'gemini';

// 與前端 AIModelPicker 顯示名稱同一來源
const GEMINI_MODEL_NAME = QUIZ_MODEL_OPTIONS.gemini.id;
const CLAUDE_MODEL_NAME = QUIZ_MODEL_OPTIONS.claude.id;

// 判斷伺服器端是否已配置對應 API 金鑰
const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY?.trim());
const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

// 兩個 SDK 實例在 module 層級建立，避免每次請求重建
// GEMINI_API_KEY 未設定時不建立 Gemini 實例，避免 SDK 帶空 key 呼叫 Google API 出現 403
const genAI = hasGeminiKey
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })
  : null;
const anthropic = hasAnthropicKey ? new Anthropic() : null;

// 過載 / 限流自動重試，最多 3 次遞增 backoff；全部受時間預算約束（見 src/lib/ai/aiDeadline.ts）
// fn 收到這次呼叫的 AbortSignal 與 timeoutMs，必須轉交給 SDK
function callWithRetry<T>(
  deadline: Deadline,
  fn: (signal: AbortSignal, timeoutMs: number) => Promise<T>,
): Promise<T> {
  return callWithDeadline(fn, {
    deadline,
    maxRetries: 3,
    baseDelayMs: 1500,
    attemptCapMs: ATTEMPT_CAP_MS,
    minAttemptMs: MIN_ATTEMPT_MS,
    isRetryable: (err) => {
      const status = (err as { status?: number; code?: number }).status
        ?? (err as { code?: number }).code;
      // Anthropic 529、Gemini 429 / 5xx 都視為可重試
      return status === 429
        || status === 529
        || (typeof status === 'number' && status >= 500)
        || (err instanceof Error && err.message.includes('overloaded'));
    },
  });
}

// 分段計時 log：下次逾時可直接從 Vercel logs 看出卡在哪一段
// 測試環境不輸出（vitest-fail-on-console 會把 console.info 當失敗，其他 route 測試不必為此 spy）
function logStage(deadline: Deadline, stage: string, extra = '') {
  if (process.env.VITEST) {
    return;
  }
  // 正常流程的計時資訊用 info level（不是 warning），方便在 Vercel logs 依 level 篩
  // eslint-disable-next-line no-console
  console.info(`[generate-from-file] stage=${stage} ms=${deadline.elapsedMs()}${extra ? ` ${extra}` : ''}`);
}

// 一份多模態素材：mimeType + base64
type Media = { mimeType: string; base64: string };

// 呼叫 Gemini 2.5 Flash（省錢快速、多模態品質佳）
// 支援多份 media（例如多張照片一次出題）
async function generateWithGemini(
  media: Media[],
  prompt: string,
  deadline: Deadline,
): Promise<string> {
  if (!genAI) {
    throw new Error('GEMINI_API_KEY_MISSING');
  }
  const t0 = deadline.elapsedMs();
  const response = await callWithRetry(deadline, (signal, timeoutMs) =>
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
        abortSignal: signal,
        httpOptions: { timeout: timeoutMs },
      },
    }));

  const finishReason = response.candidates?.[0]?.finishReason;
  logStage(deadline, 'ai', `model=${GEMINI_MODEL_NAME} callMs=${deadline.elapsedMs() - t0} finish=${finishReason} chars=${(response.text ?? '').length}`);

  // finishReason 非 STOP = 輸出被截斷,丟 sentinel error 讓外層 catch 改走 Claude 重出
  if (finishReason && finishReason !== 'STOP') {
    console.warn(`[generate-from-file] Gemini finishReason=${finishReason}（${(response.text ?? '').length} 字），改走 Claude 重出`);
    throw new Error('GEMINI_TRUNCATED');
  }
  return response.text ?? '';
}

// 呼叫 Claude Sonnet 4（品質優、適合複雜題目）
// 支援多份 media（多張圖片）；PDF / document 仍維持單份
async function generateWithClaude(
  media: Media[],
  prompt: string,
  deadline: Deadline,
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

  const t0 = deadline.elapsedMs();
  // maxRetries: 0 —— SDK 預設自己會再重試 2 次，疊上外層 callWithRetry 3 次 = 最多 9 次，
  // 重試只交給受時間預算約束的 callWithRetry
  const message = await callWithRetry(deadline, (signal, timeoutMs) =>
    anthropic.messages.create({
      model: CLAUDE_MODEL_NAME,
      max_tokens: 4096,
      messages: [{ role: 'user', content }],
    }, { signal, timeout: timeoutMs, maxRetries: 0 }));
  logStage(deadline, 'ai', `model=${CLAUDE_MODEL_NAME} callMs=${deadline.elapsedMs() - t0} stop=${message.stop_reason}`);

  return (message.content[0] as { type: string; text: string }).text ?? '';
}

const DIFF_LABELS: Record<string, string> = {
  easy: '簡單（基礎記憶型）',
  medium: '中等（理解應用型）',
  hard: '困難（分析評估型）',
};

const TYPE_LABELS: Record<string, string> = {
  mc: '選擇題（4選1，標明正確選項字母）',
  tf: '是非題（答案為「○」或「✕」）',
  fill: '填空題（用 ___ 標空格，附答案；同一題有多個空格時，answer 依空格順序用「、」分隔，例如「葉綠體、氧氣」）',
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
  const deadline = createDeadline(ROUTE_BUDGET_MS);
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  // 檢查 AI 出題 quota
  const quota = await checkAndIncrementAiUsage(userId);
  if (!quota.allowed) {
    return NextResponse.json(
      { error: quota.reason, upgradeRequired: true, remaining: 0 },
      { status: 403 },
    );
  }

  const formData = await request.formData();
  // 支援單檔（PDF / 音檔）與多檔（多張圖片）
  const uploaded = formData.getAll('file').filter((v): v is File => v instanceof File);
  const typesRaw = formData.get('types') as string;
  const rawCount = Number.parseInt(formData.get('count') as string) || 5;
  const types: string[] = JSON.parse(typesRaw || '["mc"]');
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
  const prompt = isAudio
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
7. 正確答案（A/B/C/D）位置務必平均分散在四個字母之間，不要讓多題答案集中在同一個字母${buildSingleAnswerRule()}`
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
8. 若文件內容本身是選擇題格式（含①②③④或 A/B/C/D 等選項標號），出「填空題」時請將題幹與正確選項的文字內容重組成一句完整敘述句，把關鍵詞彙或答案內容挖空（用 ___ 標示），answer 填正確選項的實際文字內容；不要照抄原本的①②③④符號，也不要整段原封不動照搬選擇題格式
9. JSON 格式（下面範例只列出本次勾選的題型，只能輸出這些題型，不可額外生成範例以外的題型）：
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
  : ''}${buildCodeSnippetRule()}${buildSingleAnswerRule()}${buildNoFigureReferenceRule()}

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

  // 音檔只能走 Gemini（Claude 不支援音檔多模態）
  let effectiveModel: ModelChoice = isAudio ? 'gemini' : model;

  // 成本閘門：只有 Pro 才能用到 Claude（首選、Gemini 未設 key、截斷重出都算）
  const allowClaude = await canUseClaude();

  // 免費用戶選 Claude → 靜默轉 Gemini（付費者才走 Claude；UI 照舊可選，由 server 分流）
  if (effectiveModel === 'claude' && !allowClaude) {
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
    if (!allowClaude) {
      return NextResponse.json({ error: FREE_AI_UNAVAILABLE_MESSAGE }, { status: 503 });
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
    // （前端讀取頁數失敗時不會傳這兩個值，過去這裡會把整份大 PDF 原封不動送給 AI，
    //  命題耗時很容易超過 Vercel maxDuration 逾時，見 src/libs/pdfPageLimit.ts）
    //
    // ignoreEncryption: true —— 踩過的坑：老師上傳的 PDF 若有加密限制（常見於證照題庫
    // 下載檔，通常是防修改/防列印，不是版權 DRM），pdf-lib 預設遇到加密 PDF 會直接
    // throw EncryptedPDFError；同一份檔案送去前端 pdfjs-dist 讀頁數時也會失敗，
    // 導致頁數選擇器完全不出現（見 AIQuizModal.tsx / FileQuizGenerator.tsx 的靜默 catch）。
    // 更關鍵的是：就算不裁切、直接把原始 bytes 送給 AI，AI 多模態模型很可能因為
    // PDF 帶著加密限制而讀不到內容，這才是「命題失敗」最直接的原因——不只是逾時。
    // 解法：一律用 pdf-lib 讀取＋透過 copyPages 重新輸出成一份乾淨的 PDF（不帶原始
    // 加密限制），不論需不需要裁切頁數，都不要把原始 bytes 直接送給 AI。
    const arrayBuffer = await firstFile.arrayBuffer();
    const srcDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
    const actualTotalPages = srcDoc.getPageCount();

    const range = resolvePdfPageRange({
      actualTotalPages,
      requestedStartPage: startPage,
      requestedEndPage: endPage,
    });
    if (!range.ok) {
      return NextResponse.json({ error: range.error }, { status: 400 });
    }

    const newDoc = await PDFDocument.create();
    const indices = Array.from(
      { length: range.endPage - range.startPage + 1 },
      (_, i) => range.startPage - 1 + i,
    );
    const copiedPages = await newDoc.copyPages(srcDoc, indices);
    copiedPages.forEach(page => newDoc.addPage(page));
    const pdfBytes = await newDoc.save();

    media.push({
      mimeType: 'application/pdf',
      base64: Buffer.from(pdfBytes).toString('base64'),
    });
  }

  logStage(deadline, 'prepare', `model=${effectiveModel} files=${uploaded.length} bytes=${media.reduce((n, m) => n + m.base64.length, 0)} types=${types.join(',')} count=${count}`);

  try {
    let raw: string;
    try {
      raw = effectiveModel === 'claude'
        ? await generateWithClaude(media, prompt, deadline)
        : await generateWithGemini(media, prompt, deadline);
    } catch (err) {
      // 整份重出至少要留 MIN_FALLBACK_MS，不夠就直接回原本的錯誤（不硬撐到被平台砍掉）
      const canFallback = !(err instanceof AIDeadlineError)
        && canStartAttempt(deadline, { minAttemptMs: MIN_FALLBACK_MS });
      if (canFallback && err instanceof Error && err.message === 'GEMINI_TRUNCATED' && hasAnthropicKey && allowClaude) {
        // Gemini 截斷自動 fallback Claude（要有 ANTHROPIC_API_KEY，且限 Pro）
        raw = await generateWithClaude(media, prompt, deadline);
      } else if (canFallback && effectiveModel === 'claude' && hasGeminiKey && !isAudio) {
        // Claude 失敗（額度不足/過載等）→ fallback Gemini（音檔本來就只走 Gemini，不會進這裡）
        console.warn('[generate-from-file] Claude 失敗，fallback Gemini：', err instanceof Error ? err.message : err);
        raw = await generateWithGemini(media, prompt, deadline);
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

    // 程式題:AI 把程式碼放在獨立欄位就併回題目;仍缺程式碼的題目記 log(前端會另外警告老師)
    const codeCheck = ensureCodeSnippets(result.questions);
    if (codeCheck.repaired || codeCheck.missing.length) {
      console.warn(`[generate-from-file] ${effectiveModel} 程式碼修補 ${codeCheck.repaired} 題,仍缺程式碼題目 index=${JSON.stringify(codeCheck.missing)}`);
    }

    // 圖解:mc/tf/fill 題型若 AI 判斷需要,附上 diagramSvg(fail-open,失敗就不附圖)
    if (result.questions) {
      attachDiagramSvgs(result.questions);
    }

    logStage(deadline, 'done', `model=${effectiveModel} questions=${result.questions?.length ?? 0}`);
    return NextResponse.json(result);
  } catch (err) {
    // 時間預算用完：回 504 JSON，前端能顯示具體建議（而不是平台逾時的非 JSON 錯誤頁）
    if (err instanceof AIDeadlineError) {
      console.error(`[generate-from-file] stage=deadline ms=${deadline.elapsedMs()} model=${effectiveModel} 時間預算用完`, err.cause ?? '');
      return NextResponse.json(
        { error: AI_TIMEOUT_MESSAGE, retryable: true },
        { status: 504 },
      );
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

    // Gemini 截斷且不能走 Claude 重出（非 Pro 或沒設 Claude 金鑰）
    if (msg === 'GEMINI_TRUNCATED') {
      return NextResponse.json(
        { error: 'AI 輸出過長被截斷，請減少題數或縮小頁數範圍後再試', retryable: true },
        { status: 503 },
      );
    }

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
