/**
 * 從 YouTube 影片或 Google Docs 連結自動抓取內容 → AI 出題
 *
 * POST /api/ai/generate-from-url
 * Body: { url, types, count, difficulty }
 *
 * 支援：
 * - YouTube：抓自動字幕（公開影片）
 * - Google Docs：抓純文字（需設為「知道連結的人可檢視」）
 */

import Anthropic from '@anthropic-ai/sdk';
import { auth } from '@clerk/nextjs/server';
import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';

import { checkAndIncrementAiUsage } from '@/actions/aiUsageActions';

export const runtime = 'nodejs';
export const maxDuration = 60;

const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY?.trim());
const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

const genAI = hasGeminiKey
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })
  : null;
const anthropic = hasAnthropicKey ? new Anthropic() : null;

// YouTube video ID 擷取（支援多種 URL 格式）
function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([\w-]{11})/,
    /youtube\.com\/shorts\/([\w-]{11})/,
  ];
  for (const p of patterns) {
    const match = url.match(p);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

// Google Docs ID 擷取
function extractGoogleDocId(url: string): string | null {
  const match = url.match(/docs\.google\.com\/document\/d\/([\w-]+)/);
  return match?.[1] ?? null;
}

// 判斷 URL 類型
type UrlType = 'youtube' | 'googledoc' | 'unknown';
function detectUrlType(url: string): UrlType {
  if (extractYouTubeId(url)) {
    return 'youtube';
  }
  if (extractGoogleDocId(url)) {
    return 'googledoc';
  }
  return 'unknown';
}

// 將 youtube-transcript 錯誤分類成老師看得懂的繁中訊息
function classifyYouTubeError(err: unknown): string {
  const msg = err instanceof Error ? err.message.toLowerCase() : '';

  // 字幕被上傳者關閉
  if (msg.includes('disabled')) {
    return '此影片的字幕已被上傳者關閉，無法擷取內容。請嘗試其他影片，或改用「上傳講義」模式。';
  }
  // 影片不存在 / 私人 / 已刪除
  if (msg.includes('unavailable') || msg.includes('not found') || msg.includes('404')) {
    return '此影片不存在或為私人影片，無法讀取。請確認連結正確且影片為公開。';
  }
  // 沒有任何字幕（自動字幕未產生）
  if (msg.includes('no transcript') || msg.includes('could not') || msg.includes('transcript')) {
    return '此影片沒有可用的字幕（可能尚未自動產生）。請嘗試其他影片，或改用「上傳講義」模式。';
  }
  // 網路逾時 / 伺服器錯誤
  if (msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('fetch') || msg.includes('network')) {
    return '系統暫時無法讀取 YouTube，請稍後再試。';
  }
  // 未知錯誤
  return 'YouTube 字幕擷取失敗，請確認連結正確後重試。';
}

// 抓 YouTube 字幕文字
async function fetchYouTubeTranscript(videoId: string): Promise<string> {
  // 優先抓繁中 → 簡中 → 自動偵測
  let transcriptItems;
  try {
    transcriptItems = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'zh-TW' })
      .catch(() => YoutubeTranscript.fetchTranscript(videoId, { lang: 'zh' }))
      .catch(() => YoutubeTranscript.fetchTranscript(videoId));
  } catch (err) {
    throw new Error(classifyYouTubeError(err));
  }

  if (!transcriptItems || transcriptItems.length === 0) {
    throw new Error('此影片沒有可用的字幕（可能尚未自動產生）。請嘗試其他影片，或改用「上傳講義」模式。');
  }

  return transcriptItems.map(item => item.text).join(' ');
}

// 抓 Google Docs 純文字（僅限公開文件）
async function fetchGoogleDocText(docId: string): Promise<string> {
  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
  const res = await fetch(exportUrl, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error('無法讀取此 Google 文件，請確認已設為「知道連結的人可檢視」');
  }
  const text = await res.text();
  if (!text || text.trim().length < 10) {
    throw new Error('文件內容太少，無法出題');
  }
  return text;
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

// 過載自動重試
async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number; code?: number }).status
        ?? (err as { code?: number }).code;
      const retryable = status === 429 || status === 529 || (typeof status === 'number' && status >= 500);
      if (!retryable || i === maxRetries - 1) {
        throw err;
      }
      await new Promise(r => setTimeout(r, (i + 1) * 1500));
    }
  }
  throw new Error('AI API 目前過載，請稍後再試');
}

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
  const url: string = body.url?.trim();
  const types: string[] = body.types ?? ['mc'];
  const count: number = body.count ?? 5;
  const difficulty: string = body.difficulty ?? 'medium';
  const model: string = body.model ?? 'gemini';

  if (!url) {
    return NextResponse.json({ error: '請提供連結' }, { status: 400 });
  }

  const urlType = detectUrlType(url);
  if (urlType === 'unknown') {
    return NextResponse.json(
      { error: '目前僅支援 YouTube 影片連結和 Google 文件連結' },
      { status: 400 },
    );
  }

  // 抓取內容
  let sourceText: string;
  let sourceLabel: string;
  try {
    if (urlType === 'youtube') {
      const videoId = extractYouTubeId(url)!;
      sourceText = await fetchYouTubeTranscript(videoId);
      sourceLabel = 'YouTube 影片字幕';
    } else {
      const docId = extractGoogleDocId(url)!;
      sourceText = await fetchGoogleDocText(docId);
      sourceLabel = 'Google 文件';
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '內容抓取失敗';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // 截取前 15000 字避免超過 token 限制
  const trimmedText = sourceText.slice(0, 15000);

  const diffLabel = DIFF_LABELS[difficulty] || '中等';
  const typesPrompt = types.map(t => `- ${TYPE_LABELS[t]}，共 ${count} 題`).join('\n');

  const prompt = `你是台灣高中的出題專家。以下是從${sourceLabel}擷取的內容，請根據此內容出題。

來源內容：
${trimmedText}

難度：${diffLabel}
出題類型：
${typesPrompt}

規則：
1. 所有題目必須根據上面內容出題，不可自行捏造
2. 只回傳合法 JSON，不要 markdown 或任何說明文字
3. 數學與科學符號只能使用 Unicode（如 π √ ² ³ ½ ≤ ≥ × ÷ ± ∞ ≠ ≈ ∑ ∫），禁止使用 LaTeX 語法
4. 分數寫作 1/2、2/3；次方寫作 x²、x³；根號寫作 √2
5. JSON 格式：
{
  "title": "根據內容自動命名的試卷標題",
  "questions": [
    { "type": "mc", "question": "題目", "options": ["(A)..","(B)..","(C)..","(D).."], "answer": "A", "explanation": "說明" },
    { "type": "tf", "question": "敘述句題目", "answer": "○", "explanation": "說明" },
    { "type": "fill", "question": "含 ___ 的題目", "answer": "答案", "explanation": "" },
    { "type": "short", "question": "簡答題目", "answer": "參考答案", "explanation": "" },
    { "type": "rank", "question": "請依時間先後排列下列事件", "options": ["事件A","事件B","事件C","事件D"], "answer": ["事件A","事件B","事件C","事件D"], "explanation": "說明" }
  ]
}
每種題型各出 ${count} 題，只出勾選的題型，所有文字使用繁體中文。`;

  // 選定模型：Gemini 未設 key 時自動 fallback 到 Claude
  let effectiveModel = model;
  if (effectiveModel !== 'claude' && !hasGeminiKey) {
    if (!hasAnthropicKey) {
      return NextResponse.json(
        { error: 'AI 命題服務尚未啟用：伺服器缺少 GEMINI_API_KEY 與 ANTHROPIC_API_KEY，請聯繫管理員。' },
        { status: 503 },
      );
    }
    console.warn('[generate-from-url] GEMINI_API_KEY 未設定，自動改用 Claude');
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

    if (effectiveModel === 'claude') {
      const message = await callWithRetry(() =>
        anthropic!.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        }));
      raw = (message.content[0] as { type: string; text: string }).text ?? '';
    } else {
      const response = await callWithRetry(() =>
        genAI!.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { maxOutputTokens: 8192, responseMimeType: 'application/json' },
        }));
      raw = response.text ?? '';
    }

    const match = raw.match(/\{[\s\S]*\}/);
    const jsonText = match ? match[0] : raw;

    let result;
    try {
      result = JSON.parse(jsonText);
    } catch {
      console.error(`[generate-from-url] ${model} 回傳非 JSON：`, raw.slice(0, 500));
      return NextResponse.json({ error: 'AI 回傳格式錯誤，請重試' }, { status: 500 });
    }

    // 後處理：確保聽力題 type 正確
    const hasListening = types.includes('listening');
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

    return NextResponse.json(result);
  } catch (err) {
    const status = (err as { status?: number; code?: number }).status
      ?? (err as { code?: number }).code;
    const msg = err instanceof Error ? err.message : '未知錯誤';

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

    console.error(`[generate-from-url] ${effectiveModel} 呼叫失敗：`, err);
    return NextResponse.json({ error: `AI 命題失敗：${msg}` }, { status: 500 });
  }
}
