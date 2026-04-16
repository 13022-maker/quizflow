/**
 * AI 助教提示生成 API
 *
 * POST /api/ai/generate-hints/[quizId]
 * 回傳：{ hints: { [questionId]: string } }
 *
 * 流程：
 * 1. 撈該 quiz 所有題目
 * 2. 已有 ai_hint 的直接帶回
 * 3. 沒有的批次送 Gemini 生成（單次 batch 節省 API calls）
 * 4. 生成完成寫回 DB
 *
 * 公開 endpoint：學生無需登入即可使用（quiz 本身已公開作答）
 */

import { GoogleGenAI } from '@google/genai';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { questionSchema, quizSchema } from '@/models/Schema';

export const runtime = 'nodejs';
export const maxDuration = 60;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });

// Gemini 過載 / 限流自動重試（429 / 5xx）
async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      const status = (err as { status?: number; code?: number }).status
        ?? (err as { code?: number }).code;
      // 從 message 中也抓 status（Gemini 有時錯誤物件包在 JSON 字串裡）
      const extractedStatus = msg.match(/"code":(\d{3})/)?.[1];
      const effectiveStatus = status ?? (extractedStatus ? Number.parseInt(extractedStatus, 10) : undefined);
      const retryable
        = effectiveStatus === 429
        || effectiveStatus === 503
        || (typeof effectiveStatus === 'number' && effectiveStatus >= 500);
      if (!retryable || i === maxRetries - 1) {
        throw err;
      }
      await new Promise(r => setTimeout(r, (i + 1) * 2000));
    }
  }
  throw new Error('Gemini API 目前忙碌，請稍後再試');
}

export async function POST(
  _req: Request,
  { params }: { params: { quizId: string } },
) {
  const quizId = Number(params.quizId);
  if (Number.isNaN(quizId)) {
    return NextResponse.json({ error: 'quizId 不合法' }, { status: 400 });
  }

  // 確認 quiz 存在且已發佈
  const [quiz] = await db
    .select({ status: quizSchema.status })
    .from(quizSchema)
    .where(eq(quizSchema.id, quizId))
    .limit(1);
  if (!quiz || quiz.status !== 'published') {
    return NextResponse.json({ error: '測驗不存在或未發佈' }, { status: 404 });
  }

  const questions = await db
    .select()
    .from(questionSchema)
    .where(eq(questionSchema.quizId, quizId));

  // 已有 ai_hint 的先放入結果
  const hints: Record<number, string> = {};
  const toGenerate: typeof questions = [];
  for (const q of questions) {
    if (q.aiHint) {
      hints[q.id] = q.aiHint;
    } else {
      toGenerate.push(q);
    }
  }

  if (toGenerate.length === 0) {
    return NextResponse.json({ hints });
  }

  // 構造批次 prompt：一次送多題減少 API calls
  // Gemini JSON 模式保證結構化輸出
  const prompt = `以下是 ${toGenerate.length} 道考題。請為每一題寫一段**不超過 57 字**的解題提示，讓**國中生**能看懂。
提示內容要：
1. 說明關鍵概念或解題思路，不要直接公布答案
2. 用繁體中文，語氣親切像家教
3. 嚴格不超過 57 字
4. 只回傳合法 JSON

題目列表：
${toGenerate.map((q, i) => `[${i}] ${q.body}`).join('\n')}

JSON 格式（index 對應上面編號）：
{"hints":[{"index":0,"hint":"..."},{"index":1,"hint":"..."}]}`;

  try {
    const response = await callWithRetry(() =>
      ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      }));

    const raw = response.text ?? '';
    let parsed: { hints?: { index: number; hint: string }[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error('[generate-hints] JSON parse 失敗：', raw.slice(0, 300));
      return NextResponse.json({ error: 'AI 回傳格式錯誤' }, { status: 500 });
    }

    const generated = parsed.hints ?? [];

    // 對應回 questionId，寫回 DB、帶入 hints map
    for (const item of generated) {
      const q = toGenerate[item.index];
      if (!q || typeof item.hint !== 'string') {
        continue;
      }
      // 保險截斷到 57 字
      const trimmed = item.hint.slice(0, 57);
      hints[q.id] = trimmed;

      // 寫回 DB 快取（非同步不等完成，避免拖慢回應）
      db.update(questionSchema)
        .set({ aiHint: trimmed })
        .where(eq(questionSchema.id, q.id))
        .catch(err => console.error('[generate-hints] DB 寫入失敗', q.id, err));
    }

    return NextResponse.json({ hints });
  } catch (err) {
    console.error('[generate-hints] Gemini 呼叫失敗：', err);
    const msg = err instanceof Error ? err.message : '未知錯誤';
    // 判斷是否為 Gemini 服務忙碌（過載 / 限流），回 503 讓前端知道可重試
    const overloaded
      = /"code":(?:429|50\d)/.test(msg)
      || msg.includes('high demand')
      || msg.includes('UNAVAILABLE')
      || msg.includes('overloaded');
    if (overloaded) {
      return NextResponse.json(
        { error: 'AI 助教正忙碌中，請等 30 秒後重試', retryable: true },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: `AI 生成失敗：${msg}` }, { status: 500 });
  }
}
