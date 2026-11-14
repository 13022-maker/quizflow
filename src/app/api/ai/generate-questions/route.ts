/**
 * 文字主題出題 API
 * 主用 Gemini 2.5 Flash，失敗時依序 fallback OpenAI gpt-4o-mini → Claude
 *
 * 兩種回應模式：
 * - 預設：一次回傳 { title, questions } JSON（BloomQuizGenerator 等舊呼叫端）
 * - body.stream === true：回傳 NDJSON 串流，Gemini 每生完一題就推一行，前端可邊生邊顯示
 *     {"type":"title","title":"..."}
 *     {"type":"question","question":{...}}
 *     {"type":"warning","message":"..."}
 *     {"type":"error","error":"..."}
 *     {"type":"done","count":N,"model":"gemini"}
 */

import { auth } from '@clerk/nextjs/server';
import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

import { checkAndIncrementAiUsage } from '@/actions/aiUsageActions';
import { attachDiagramSvgs } from '@/lib/ai/diagramSvg';
import { questionNdjsonResponse } from '@/lib/ai/questionNdjsonStream';
import { buildQuestionPrompt } from '@/lib/ai/questionPrompt';

export const runtime = 'nodejs';
// Hobby + Fluid compute 上限 300 秒；Gemini → OpenAI → Claude 三段備援全跑一輪可能超過 60 秒
export const maxDuration = 300;

const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });

const GEMINI_CONFIG = {
  // 關掉 thinking 讓 100% token 給 JSON 輸出；上限提到 16384 防長題截斷
  maxOutputTokens: 16384,
  responseMimeType: 'application/json',
  thinkingConfig: { thinkingBudget: 0 },
};

type Question = Record<string, any>;

class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// ── 後處理（單題）：聽力題 type 修正 + 圖解 SVG ──
function postProcessQuestion(q: Question, types: string[]): Question {
  const hasListening = types.includes('listening');
  if (hasListening) {
    // 有些模型會回傳 mc 而非 listening
    if (q.listeningText && q.type !== 'listening') {
      q.type = 'listening';
    }
    if (types.length === 1 && q.type === 'mc') {
      q.type = 'listening';
    }
  }
  // mc/tf/fill 題型若 AI 判斷需要，附上 diagramSvg（fail-open，失敗就不附圖）
  attachDiagramSvgs([q as { type: string; diagram?: unknown; diagramSvg?: string }]);
  return q;
}

function parseResult(raw: string, usedModel: string): { title?: string; questions?: Question[] } {
  const match = raw.match(/\{[\s\S]*\}/);
  const jsonText = match ? match[0] : raw;
  try {
    return JSON.parse(jsonText);
  } catch {
    console.error(`[generate-questions] ${usedModel} 回傳非 JSON：`, raw.slice(0, 500));
    throw new HttpError('AI 回傳格式錯誤，請重試', 500);
  }
}

// ── Gemini 失敗後的備援鏈：OpenAI → Claude（非串流，回傳完整文字）──
async function runFallbackChain(prompt: string): Promise<{ raw: string; usedModel: string }> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    throw new HttpError('AI 備援服務未設定（缺少 OPENAI_API_KEY）', 503);
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
    return { raw: openaiData.choices?.[0]?.message?.content ?? '', usedModel: 'openai' };
  } catch (openaiErr) {
    console.error('[generate-questions] OpenAI fallback 失敗，嘗試 Claude：', openaiErr);

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      const msg = openaiErr instanceof Error ? openaiErr.message : '未知錯誤';
      throw new HttpError(`AI 命題失敗：${msg}`, 500);
    }
    try {
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!claudeRes.ok) {
        const errBody = await claudeRes.text();
        throw new Error(`Claude ${claudeRes.status}: ${errBody.slice(0, 200)}`);
      }
      const claudeData = await claudeRes.json();
      return { raw: claudeData.content?.[0]?.text ?? '', usedModel: 'claude' };
    } catch (claudeErr) {
      const msg = claudeErr instanceof Error ? claudeErr.message : '未知錯誤';
      console.error('[generate-questions] Claude 第三備援也失敗：', claudeErr);
      throw new HttpError(`AI 命題失敗：${msg}`, 500);
    }
  }
}

// ── 非串流模式（舊行為）──
async function generateOnce(prompt: string, types: string[]) {
  let raw: string;
  let usedModel = 'gemini';
  try {
    const response = await gemini.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: GEMINI_CONFIG,
    });
    raw = response.text ?? '';
    // finishReason 非 STOP（最常見是 MAX_TOKENS）= 輸出被截斷，JSON 不完整，直接觸發 fallback chain 重出
    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      console.warn(`[generate-questions] Gemini finishReason=${finishReason}（${raw.length} 字），改走 fallback chain 重出`);
      throw new Error('GEMINI_TRUNCATED');
    }
  } catch (geminiErr) {
    console.warn('[generate-questions] Gemini 失敗，fallback OpenAI：', geminiErr instanceof Error ? geminiErr.message : geminiErr);
    ({ raw, usedModel } = await runFallbackChain(prompt));
  }

  const result = parseResult(raw, usedModel);
  if (Array.isArray(result.questions)) {
    result.questions = result.questions.map(q => postProcessQuestion(q, types));
  }
  return result;
}

// ── 串流模式：Gemini 串流為主，一題都沒出才走 OpenAI → Claude 備援 ──
function generateStream(prompt: string, types: string[]): Response {
  return questionNdjsonResponse({
    logTag: 'generate-questions',
    primaryModel: 'gemini',
    primary: () => gemini.models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: GEMINI_CONFIG,
    }),
    fallback: () => runFallbackChain(prompt),
    postProcess: q => postProcessQuestion(q, types),
    errorMessage: err => (err instanceof Error ? err.message : 'AI 命題失敗，請重試'),
  });
}

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
  const { topic, difficulty = 'medium', framework } = body;
  const types: string[] = Array.isArray(body.types) && body.types.length ? body.types : ['mc'];
  const hasListening = types.includes('listening');
  const count = Math.min(Number(body.count) || 5, hasListening ? 5 : 20);

  if (!topic?.trim()) {
    return NextResponse.json({ error: '請輸入主題或內容' }, { status: 400 });
  }

  const prompt = buildQuestionPrompt({ topic, types, count, difficulty, framework });

  if (body.stream === true) {
    return generateStream(prompt, types);
  }

  try {
    return NextResponse.json(await generateOnce(prompt, types));
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : 'AI 命題失敗' }, { status });
  }
}
