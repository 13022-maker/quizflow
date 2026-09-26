/**
 * 協作批閱題組一鍵生成 API
 * 主用 Gemini 2.5 Flash（免費），過載時自動 fallback 到 OpenAI GPT-4o mini，再 fallback Claude
 * 流程/備援結構跟 generate-questions/route.ts 一致
 */

import { auth } from '@clerk/nextjs/server';
import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { checkAndIncrementAiUsage } from '@/actions/aiUsageActions';
import { buildReviewSetPrompt, parseGeneratedReviewSet } from '@/lib/ai/reviewSetGeneration';

export const runtime = 'nodejs';
export const maxDuration = 60;

const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });

const BodySchema = z.object({
  title: z.string().trim().min(1, '請輸入標題').max(100, '標題最多 100 字'),
});

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 });
  }
  const parsedBody = BodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json({ error: parsedBody.error.errors[0]?.message ?? '資料格式錯誤' }, { status: 400 });
  }

  const prompt = buildReviewSetPrompt(parsedBody.data.title);

  // 主用 Gemini，過載時 fallback OpenAI，再 fallback Claude
  let raw: string;
  let usedModel = 'gemini';

  try {
    const response = await gemini.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    raw = response.text ?? '';
    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      console.warn(`[generate-review-set] Gemini finishReason=${finishReason}（${raw.length} 字），改走 fallback chain 重出`);
      throw new Error('GEMINI_TRUNCATED');
    }
  } catch (geminiErr) {
    console.warn('[generate-review-set] Gemini 失敗，fallback OpenAI：', geminiErr instanceof Error ? geminiErr.message : geminiErr);

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
          max_tokens: 2048,
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
      console.error('[generate-review-set] OpenAI fallback 失敗，嘗試 Claude：', openaiErr);

      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) {
        const msg = openaiErr instanceof Error ? openaiErr.message : '未知錯誤';
        return NextResponse.json({ error: `AI 生成失敗：${msg}` }, { status: 500 });
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
            model: 'claude-sonnet-4-6',
            max_tokens: 2048,
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
        console.error('[generate-review-set] Claude 第三備援也失敗：', claudeErr);
        return NextResponse.json({ error: `AI 生成失敗：${msg}` }, { status: 500 });
      }
    }
  }

  const result = parseGeneratedReviewSet(raw);
  if (!result) {
    console.error(`[generate-review-set] ${usedModel} 回傳格式錯誤：`, raw.slice(0, 500));
    return NextResponse.json({ error: 'AI 回傳格式錯誤，請重試' }, { status: 500 });
  }

  return NextResponse.json(result);
}
