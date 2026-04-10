// Anthropic SDK 需要 Node.js Runtime（Edge 不支援）
import Anthropic from '@anthropic-ai/sdk';
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { checkAndIncrementAiUsage } from '@/actions/aiUsageActions';

export const runtime = 'nodejs';

const client = new Anthropic();

// 難度說明
const DIFF_LABELS: Record<string, string> = {
  easy: '簡單（基礎記憶型）',
  medium: '中等（理解應用型）',
  hard: '困難（分析評估型）',
};

// 題型說明
const TYPE_LABELS: Record<string, string> = {
  mc: '選擇題（4選1，標明正確選項字母）',
  tf: '是非題（答案為「○」或「✕」）',
  fill: '填空題（用 ___ 標空格，附答案）',
  short: '簡答題（附參考答案）',
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

  const body = await request.json();
  const { topic, types = ['mc'], count = 5, difficulty = 'medium' } = body;

  if (!topic?.trim()) {
    return NextResponse.json({ error: '請輸入主題或內容' }, { status: 400 });
  }

  const diffLabel = DIFF_LABELS[difficulty] ?? '中等';
  const typesPrompt = (types as string[])
    .map(t => `- ${TYPE_LABELS[t] ?? t}，共 ${count} 題`)
    .join('\n');

  const prompt = `你是台灣高中的出題專家，請根據以下主題或課文內容出題。

主題／內容：
${topic}

難度：${diffLabel}
出題類型：
${typesPrompt}

規則：
1. 根據提供的主題或內容出題，不可自行捏造
2. 只回傳合法 JSON，不要 markdown 或任何說明文字
3. JSON 格式：
{
  "title": "根據主題自動命名的試卷標題",
  "questions": [
    { "type": "mc", "question": "題目", "options": ["(A)選項一","(B)選項二","(C)選項三","(D)選項四"], "answer": "A", "explanation": "說明" },
    { "type": "tf", "question": "敘述句題目", "answer": "○", "explanation": "說明" },
    { "type": "fill", "question": "含 ___ 的題目", "answer": "答案", "explanation": "" },
    { "type": "short", "question": "簡答題目", "answer": "參考答案", "explanation": "" }
  ]
}
每種題型各出 ${count} 題，只出勾選的題型，所有文字使用繁體中文。`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = (message.content[0] as { type: string; text: string }).text ?? '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return NextResponse.json({ error: 'AI 回傳格式錯誤，請重試' }, { status: 500 });
    }

    const result = JSON.parse(match[0]);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知錯誤';
    return NextResponse.json({ error: `AI 命題失敗：${msg}` }, { status: 500 });
  }
}
