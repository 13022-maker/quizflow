// pdf-lib、Buffer 是 Node.js 專屬 API，必須明確指定 Node.js Runtime
import { Buffer } from 'node:buffer';

import Anthropic from '@anthropic-ai/sdk';
import { auth } from '@clerk/nextjs/server';
import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';

import { checkAndIncrementAiUsage } from '@/actions/aiUsageActions';

export const runtime = 'nodejs';
export const maxDuration = 60;

type ModelChoice = 'gemini' | 'claude';
const DEFAULT_MODEL: ModelChoice = 'gemini';

const GEMINI_MODEL_NAME = 'gemini-2.5-flash';
const CLAUDE_MODEL_NAME = 'claude-sonnet-4-20250514';

// 兩個 SDK 實例在 module 層級建立，避免每次請求重建
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });
const anthropic = new Anthropic();

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

// 呼叫 Gemini 2.5 Flash（省錢快速、多模態品質佳）
async function generateWithGemini(
  mimeType: string,
  base64: string,
  prompt: string,
): Promise<string> {
  const response = await callWithRetry(() =>
    genAI.models.generateContent({
      model: GEMINI_MODEL_NAME,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: base64 } },
            { text: prompt },
          ],
        },
      ],
      config: {
        maxOutputTokens: 8192,
        responseMimeType: 'application/json', // 強制 JSON 輸出
      },
    }));

  return response.text ?? '';
}

// 呼叫 Claude Sonnet 4（品質優、適合複雜題目）
async function generateWithClaude(
  mimeType: string,
  base64: string,
  prompt: string,
): Promise<string> {
  // Claude 多模態格式 — image / document 分開
  const isImage = mimeType.startsWith('image/');
  const content: Anthropic.MessageParam['content'] = isImage
    ? [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
            data: base64,
          },
        },
        { type: 'text', text: prompt },
      ]
    : [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 },
        },
        { type: 'text', text: prompt },
      ];

  const message = await callWithRetry(() =>
    anthropic.messages.create({
      model: CLAUDE_MODEL_NAME,
      max_tokens: 4096,
      messages: [{ role: 'user', content }],
    }));

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
  fill: '填空題（用 ___ 標空格，附答案）',
  short: '簡答題（附參考答案）',
  rank: '排序題（提供 3-5 個項目，answer 為依正確順序排列的項目陣列）',
};

export async function POST(request: Request) {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  // 檢查 AI 出題 quota
  const quota = await checkAndIncrementAiUsage(orgId);
  if (!quota.allowed) {
    return NextResponse.json(
      { error: quota.reason, upgradeRequired: true, remaining: 0 },
      { status: 403 },
    );
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
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

  if (!file) {
    return NextResponse.json({ error: '請上傳檔案' }, { status: 400 });
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
  const isPDF = ext === 'pdf';
  const isAudio = ['mp3', 'wav', 'm4a', 'ogg', 'webm', 'aac', 'flac'].includes(ext)
    || file.type.startsWith('audio/');

  if (!isImage && !isPDF && !isAudio) {
    return NextResponse.json(
      { error: '支援 PDF、圖片、音檔格式。Word 請另存 PDF 後上傳' },
      { status: 400 },
    );
  }

  if (isPDF && endPage > 0) {
    const pageCount = endPage - startPage + 1;
    if (pageCount > 20) {
      return NextResponse.json(
        { error: `選取範圍共 ${pageCount} 頁，超過上限 20 頁，請縮小範圍後重試` },
        { status: 400 },
      );
    }
  }

  const diffLabel = DIFF_LABELS[difficulty] || '中等';
  const typesPrompt = types.map(t => `- ${TYPE_LABELS[t]}，共 ${count} 題`).join('\n');

  // 音檔用聽力題專用 prompt，文件 / 圖片用一般 prompt
  const prompt = isAudio
    ? `請聽取以上音檔內容，根據音檔生成聽力測驗題。

難度：${diffLabel}
每種題型各出 ${count} 題，所有文字使用繁體中文。

規則：
1. 所有題目必須根據音檔的實際內容出題，不可自行捏造
2. 只回傳合法 JSON，不要 markdown 或任何說明文字
3. 每題都是聽力選擇題（type 一律為 "listening"）
4. JSON 格式：
{
  "title": "根據音檔內容命名的聽力測驗標題",
  "transcript": "音檔的完整逐字稿（繁體中文）",
  "questions": [
    { "type": "listening", "question": "根據音檔，以下哪個說法正確？", "options": ["(A)..","(B)..","(C)..","(D).."], "answer": "A", "explanation": "說明" }
  ]
}`
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
8. JSON 格式：
{
  "title": "根據文件內容自動命名的試卷標題",
  "questions": [
    { "type": "mc", "question": "題目", "options": ["(A)..","(B)..","(C)..","(D).."], "answer": "A", "explanation": "說明" },
    { "type": "tf", "question": "敘述句題目", "answer": "○", "explanation": "說明" },
    { "type": "fill", "question": "含 ___ 的題目", "answer": "答案", "explanation": "" },
    { "type": "short", "question": "簡答題目", "answer": "參考答案", "explanation": "" },
    { "type": "rank", "question": "請依時間先後排列下列事件", "options": ["文藝復興","工業革命","二次大戰","網際網路誕生"], "answer": ["文藝復興","工業革命","二次大戰","網際網路誕生"], "explanation": "說明" }
  ]
}
每種題型各出 ${count} 題，只出勾選的題型。`;

  // 讀取原始檔案位元組 + 準備 mime / base64
  const arrayBuffer = await file.arrayBuffer();

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
  const effectiveModel: ModelChoice = isAudio ? 'gemini' : model;

  let mimeType: string;
  let base64: string;

  if (isAudio) {
    mimeType = audioMimeMap[ext] || file.type || 'audio/mpeg';
    base64 = Buffer.from(arrayBuffer).toString('base64');
  } else if (isImage) {
    mimeType = imageMimeMap[ext] || 'image/png';
    base64 = Buffer.from(arrayBuffer).toString('base64');
  } else {
    // PDF：若有傳頁數範圍用 pdf-lib 裁切後再傳
    let pdfBytes: Uint8Array;
    if (endPage > 0) {
      const srcDoc = await PDFDocument.load(arrayBuffer);
      const newDoc = await PDFDocument.create();
      const totalPages = srcDoc.getPageCount();
      const safeStart = Math.max(1, startPage);
      const safeEnd = Math.min(endPage, totalPages);
      const indices = Array.from(
        { length: safeEnd - safeStart + 1 },
        (_, i) => safeStart - 1 + i,
      );
      const copiedPages = await newDoc.copyPages(srcDoc, indices);
      copiedPages.forEach(page => newDoc.addPage(page));
      pdfBytes = await newDoc.save();
    } else {
      pdfBytes = new Uint8Array(arrayBuffer);
    }
    mimeType = 'application/pdf';
    base64 = Buffer.from(pdfBytes).toString('base64');
  }

  try {
    const raw = effectiveModel === 'claude'
      ? await generateWithClaude(mimeType, base64, prompt)
      : await generateWithGemini(mimeType, base64, prompt);

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

    return NextResponse.json(result);
  } catch (err) {
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
    console.error(`[generate-from-file] ${model} 呼叫失敗：`, err);
    return NextResponse.json({ error: `AI 命題失敗：${msg}` }, { status: 500 });
  }
}
