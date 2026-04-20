/**
 * 單題重新生成 API（選擇題專用）
 * 給定 question id，依原題主題、題型、難度重新生成一題，更新 DB 回傳新內容
 * 主用 Gemini 2.5 Flash，過載時 fallback Claude Sonnet 4
 */

import Anthropic from '@anthropic-ai/sdk';
import { auth } from '@clerk/nextjs/server';
import { GoogleGenAI } from '@google/genai';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { checkAndIncrementAiUsage } from '@/actions/aiUsageActions';
import { db } from '@/libs/DB';
import { isProOrAbove } from '@/libs/Plan';
import { questionSchema, quizSchema } from '@/models/Schema';

export const runtime = 'nodejs';
export const maxDuration = 60;

const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });
const anthropic = new Anthropic();

// 判斷是否為過載 / 限流錯誤（與 generate-questions 同邏輯）
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

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  // Pro 限定功能：非 Pro 阻擋並引導升級
  const isPro = await isProOrAbove(orgId);
  if (!isPro) {
    return NextResponse.json(
      { error: '重新生成題目為 Pro 方案功能，請升級後再使用', upgradeRequired: true },
      { status: 403 },
    );
  }

  const questionId = Number(params.id);
  if (Number.isNaN(questionId)) {
    return NextResponse.json({ error: '無效的題目 ID' }, { status: 400 });
  }

  // 取題目 + 測驗，同時驗證所有權
  const [row] = await db
    .select({ question: questionSchema, quiz: quizSchema })
    .from(questionSchema)
    .innerJoin(quizSchema, eq(quizSchema.id, questionSchema.quizId))
    .where(and(eq(questionSchema.id, questionId), eq(quizSchema.ownerId, orgId)))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: '找不到題目或無權限' }, { status: 404 });
  }

  const { question, quiz } = row;

  // 目前只支援選擇題（單選 / 多選）重生
  if (question.type !== 'single_choice' && question.type !== 'multiple_choice') {
    return NextResponse.json(
      { error: '目前僅支援選擇題重新生成' },
      { status: 400 },
    );
  }

  // quota 檢查放在所有權驗證之後，避免非本人的請求也扣額度
  const quota = await checkAndIncrementAiUsage(orgId);
  if (!quota.allowed) {
    return NextResponse.json(
      { error: quota.reason, upgradeRequired: true, remaining: 0 },
      { status: 403 },
    );
  }

  const isMulti = question.type === 'multiple_choice';

  // 解析使用者額外提示（可選）
  const reqBody = await request.json().catch(() => ({}));
  const hint: string = typeof reqBody.hint === 'string' ? reqBody.hint.trim().slice(0, 200) : '';

  // 組原題給 AI 作為上下文
  const originalOptions = (question.options ?? [])
    .map((o, i) => `(${String.fromCharCode(65 + i)}) ${o.text}`)
    .join('\n');
  const originalAnswerLetters = (question.correctAnswers ?? [])
    .map((id) => {
      const idx = (question.options ?? []).findIndex(o => o.id === id);
      return idx >= 0 ? String.fromCharCode(65 + idx) : '';
    })
    .filter(Boolean)
    .join(', ');

  const prompt = `你是台灣高中的出題專家。以下是一份測驗中的一道原題目，請重新生成一道「相同題型、相同難度、相同主題」但內容不同的新題目。

測驗標題：${quiz.title}
${quiz.description ? `測驗描述：${quiz.description}` : ''}

原題目：
題目：${question.body}
選項：
${originalOptions}
正解：${originalAnswerLetters}

${hint ? `老師額外要求：${hint}` : ''}

規則：
1. 新題目必須與原題不同（不是改寫，而是同主題的新問法）
2. 題型必須是${isMulti ? '多選題（2–4 個正解）' : '單選題（1 個正解）'}，共 4 個選項
3. 難度與原題相當
4. 數學／科學符號只用 Unicode（如 π √ ² ³ ½ ≤ ≥ × ÷ ± ∞ ≠ ≈ ∑ ∫），禁止 LaTeX（不可寫 \\frac、\\sqrt、$...$）
5. 所有文字使用繁體中文
6. 只回傳合法 JSON，不要 markdown 或任何說明文字：
{
  "question": "新題目",
  "options": ["(A)...", "(B)...", "(C)...", "(D)..."],
  "answer": ${isMulti ? '"A,C"' : '"A"'},
  "explanation": "解析說明"
}`;

  // 主用 Gemini，過載時 fallback Claude
  let raw = '';
  try {
    const response = await gemini.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { maxOutputTokens: 2048, responseMimeType: 'application/json' },
    });
    raw = response.text ?? '';
  } catch (geminiErr) {
    if (!isOverloadError(geminiErr)) {
      const msg = geminiErr instanceof Error ? geminiErr.message : '未知錯誤';
      console.error('[regenerate-question] Gemini 失敗（非過載）：', geminiErr);
      return NextResponse.json({ error: `AI 重生失敗：${msg}` }, { status: 500 });
    }
    console.warn('[regenerate-question] Gemini 過載，fallback Claude');
    try {
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      });
      raw = (message.content[0] as { type: string; text: string }).text ?? '';
    } catch (claudeErr) {
      const msg = claudeErr instanceof Error ? claudeErr.message : '未知錯誤';
      console.error('[regenerate-question] Claude fallback 也失敗：', claudeErr);
      return NextResponse.json({ error: `AI 重生失敗：${msg}` }, { status: 500 });
    }
  }

  // 解析 JSON
  const match = raw.match(/\{[\s\S]*\}/);
  const jsonText = match ? match[0] : raw;
  let parsed: { question?: string; options?: unknown; answer?: string; explanation?: string };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return NextResponse.json({ error: 'AI 回傳格式錯誤' }, { status: 500 });
  }

  const newBody = typeof parsed.question === 'string' ? parsed.question.trim() : '';
  const newOptionTexts = Array.isArray(parsed.options)
    ? parsed.options.filter((t): t is string => typeof t === 'string')
    : [];
  if (!newBody || newOptionTexts.length < 2) {
    return NextResponse.json({ error: 'AI 回傳缺少題目或選項' }, { status: 500 });
  }

  // 轉成 DB 格式：{id, text}（id 用 a/b/c/d）
  const newOptions = newOptionTexts.map((text, i) => ({
    id: String.fromCharCode(97 + i),
    text,
  }));

  // answer 解析：可能是 "A" 或 "A,C"，也容忍 "(A)" 或全形逗號
  const ansStr = typeof parsed.answer === 'string' ? parsed.answer : '';
  const newCorrectAnswers = ansStr
    .split(/[,，\s]+/)
    .map(s => s.trim().toLowerCase().replace(/[()（）]/g, ''))
    .filter(Boolean)
    .map(letter => newOptions.find(o => o.id === letter)?.id)
    .filter((id): id is string => Boolean(id));

  if (newCorrectAnswers.length === 0) {
    return NextResponse.json({ error: 'AI 回傳答案無法對映' }, { status: 500 });
  }

  // 更新 DB：保留 id / position / type / points；清掉 aiHint（題目變了，舊提示作廢）
  await db
    .update(questionSchema)
    .set({
      body: newBody,
      options: newOptions,
      correctAnswers: newCorrectAnswers,
      aiHint: null,
    })
    .where(eq(questionSchema.id, questionId));

  return NextResponse.json({
    question: {
      id: questionId,
      body: newBody,
      options: newOptions,
      correctAnswers: newCorrectAnswers,
    },
    explanation: parsed.explanation ?? '',
  });
}
