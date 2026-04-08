// Anthropic SDK 需要 Node.js Runtime
import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';

const client = new Anthropic();

// 輸入驗證 schema
const InputSchema = z.object({
  wrongQuestions: z.array(
    z.object({
      question: z.string(),
      correctAnswer: z.string(),
      studentAnswer: z.string(),
    }),
  ),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = InputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: '格式錯誤' }, { status: 400 });
    }

    const { wrongQuestions } = parsed.data;

    // 沒有答錯的題目直接回傳空陣列
    if (wrongQuestions.length === 0) {
      return NextResponse.json({ weakPoints: [] });
    }

    // 組合 prompt：列出每題答錯的詳情
    const questionsText = wrongQuestions
      .map(
        (q, i) =>
          `題目${i + 1}：${q.question}\n正確答案：${q.correctAnswer}\n學生作答：${q.studentAnswer || '（未作答）'}`,
      )
      .join('\n\n');

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `你是一位學習分析助手。以下是這位學生答錯的題目，請分析學生可能不熟悉的知識概念，並給予 1-2 句具體的學習建議。

${questionsText}

請只回傳合法 JSON，格式如下（不要加任何說明文字）：
{
  "weakPoints": [
    { "concept": "概念名稱", "suggestion": "具體學習建議" }
  ]
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
