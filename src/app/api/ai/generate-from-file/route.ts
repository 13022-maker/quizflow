// pdf-lib、Buffer 是 Node.js 專屬 API，必須明確指定 Node.js Runtime
import { Buffer } from 'node:buffer';

import { auth } from '@clerk/nextjs/server';
import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';

import { checkAndIncrementAiUsage } from '@/actions/aiUsageActions';

export const runtime = 'nodejs';
export const maxDuration = 60;

// 使用 Gemini 2.5 Flash：多模態品質佳、速度快、成本約 Claude Sonnet 1/10
const GEMINI_MODEL = 'gemini-2.5-flash';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });

// Gemini 過載 / 限流時自動重試（429 / 5xx），最多 3 次遞增 backoff
async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number; code?: number }).status
        ?? (err as { code?: number }).code;
      const retryable = status === 429 || (typeof status === 'number' && status >= 500);
      if (!retryable || i === maxRetries - 1) {
        throw err;
      }
      await new Promise(r => setTimeout(r, (i + 1) * 1500));
    }
  }
  throw new Error('Gemini API 目前過載，請稍後再試');
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
  const count = Number.parseInt(formData.get('count') as string) || 5;
  const difficulty = (formData.get('difficulty') as string) || 'medium';
  const startPage = Number.parseInt(formData.get('startPage') as string) || 1;
  const endPage = Number.parseInt(formData.get('endPage') as string) || 0; // 0 代表未傳，使用全文

  if (!file) {
    return NextResponse.json({ error: '請上傳檔案' }, { status: 400 });
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
  const isPDF = ext === 'pdf';

  // 不支援 DOCX，提示使用者另存 PDF
  if (!isImage && !isPDF) {
    return NextResponse.json(
      { error: '目前僅支援 PDF 和圖片格式，請將 Word 文件另存為 PDF 後上傳' },
      { status: 400 },
    );
  }

  // 頁數範圍保護：最多 20 頁
  if (isPDF && endPage > 0) {
    const pageCount = endPage - startPage + 1;
    if (pageCount > 20) {
      return NextResponse.json(
        { error: `選取範圍共 ${pageCount} 頁，超過上限 20 頁，請縮小範圍後重試` },
        { status: 400 },
      );
    }
  }

  const types: string[] = JSON.parse(typesRaw || '["mc"]');
  const diffLabel = DIFF_LABELS[difficulty] || '中等';
  const typesPrompt = types.map(t => `- ${TYPE_LABELS[t]}，共 ${count} 題`).join('\n');

  const prompt = `請根據以上文件內容出題。

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

  // 讀取原始檔案位元組
  const arrayBuffer = await file.arrayBuffer();

  // 統一的 mime type 對映
  const imageMimeMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
  };

  let mimeType: string;
  let base64: string;

  if (isImage) {
    mimeType = imageMimeMap[ext] || 'image/png';
    base64 = Buffer.from(arrayBuffer).toString('base64');
  } else {
    // PDF：若有傳頁數範圍，用 pdf-lib 裁切後再傳 Gemini
    let pdfBytes: Uint8Array;
    if (endPage > 0) {
      const srcDoc = await PDFDocument.load(arrayBuffer);
      const newDoc = await PDFDocument.create();
      const totalPages = srcDoc.getPageCount();
      const safeStart = Math.max(1, startPage);
      const safeEnd = Math.min(endPage, totalPages);
      const indices = Array.from(
        { length: safeEnd - safeStart + 1 },
        (_, i) => safeStart - 1 + i, // 0-based
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
    const response = await callWithRetry(() =>
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType, data: base64 } },
              { text: prompt },
            ],
          },
        ],
        // 強制輸出 JSON，避免解析失敗
        config: {
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
        },
      }));

    const raw = response.text ?? '';

    // Gemini 強制 JSON mode 通常會直接回乾淨 JSON，保險起見再 regex 提取一次
    const match = raw.match(/\{[\s\S]*\}/);
    const jsonText = match ? match[0] : raw;

    let result;
    try {
      result = JSON.parse(jsonText);
    } catch {
      console.error('[generate-from-file] Gemini 回傳非 JSON：', raw.slice(0, 500));
      return NextResponse.json({ error: 'AI 回傳格式錯誤，請重試' }, { status: 500 });
    }

    return NextResponse.json(result);
  } catch (err) {
    const status = (err as { status?: number; code?: number }).status
      ?? (err as { code?: number }).code;
    if (status === 429 || (typeof status === 'number' && status >= 500)) {
      return NextResponse.json(
        { error: 'AI 伺服器目前忙碌，請稍後再試', retryable: true },
        { status: 503 },
      );
    }
    const msg = err instanceof Error ? err.message : '未知錯誤';
    console.error('[generate-from-file] Gemini 呼叫失敗：', err);
    return NextResponse.json({ error: `AI 命題失敗：${msg}` }, { status: 500 });
  }
}
