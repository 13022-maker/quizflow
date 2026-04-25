// Anthropic SDK 需要 Node.js Runtime
import Anthropic from '@anthropic-ai/sdk';
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';

const client = new Anthropic();

// 輸入驗證 schema
const InputSchema = z.object({
  quizTitle: z.string(),
  questionStats: z.array(
    z.object({
      question: z.string(),
      correctRate: z.number(),
    }),
  ),
});

export async function POST(request: Request) {
  // 僅限登入的老師使用
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = InputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: '格式錯誤' }, { status: 400 });
    }

    const { quizTitle, questionStats } = parsed.data;

    if (questionStats.length === 0) {
      return NextResponse.json({ summary: '尚無題目資料可供分析。', suggestions: [] });
    }

    // 組合各題答對率文字
    const statsText = questionStats
      .map((q, i) => `第${i + 1}題：${q.question}（答對率：${q.correctRate}%）`)
      .join('\n');

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `你是一位教學分析助手。以下是「${quizTitle}」這份測驗各題的班級答對率統計，請分析整體學習情況並給予 2-3 條具體教學建議。

${statsText}

請只回傳合法 JSON，格式如下（不要加任何說明文字）：
{
  "summary": "整體班級學習情況摘要（2-3 句）",
  "suggestions": ["具體教學建議一", "具體教學建議二", "具體教學建議三"]
}`,
        },
      ],
    });

    // 提取 JSON 文字
    const raw = (message.content[0] as { type: string; text: string }).text ?? '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return NextResponse.json({ error: 'AI 回傳格式錯誤' }, { status: 500 });
    }

    const result = JSON.parse(match[0]);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知錯誤';
    return NextResponse.json({ error: `分析失敗：${msg}` }, { status: 500 });
  }
}
