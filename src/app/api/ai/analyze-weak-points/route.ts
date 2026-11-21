import { NextResponse } from 'next/server';
import { z } from 'zod';

import { generateAIText } from '@/lib/ai/textModel';
import { enforcePublicAiLimit } from '@/libs/rateLimit';

export const runtime = 'nodejs';

// 輸入驗證 schema（公開端點：陣列長度、字串長度都要有上限，避免一次塞爆 prompt）
const InputSchema = z.object({
  wrongQuestions: z.array(
    z.object({
      question: z.string().max(2000),
      correctAnswer: z.string().max(1000),
      studentAnswer: z.string().max(1000),
    }),
  ).max(200),
});

// 送進 prompt 的錯題最多幾題（題數很多的測驗只取前面，避免 prompt 過大）
const MAX_QUESTIONS_IN_PROMPT = 50;

export async function POST(request: Request) {
  const limited = await enforcePublicAiLimit(request, 'analyze-weak-points');
  if (limited) {
    return limited;
  }
  try {
    const body = await request.json();
    const parsed = InputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: '格式錯誤' }, { status: 400 });
    }

    const wrongQuestions = parsed.data.wrongQuestions.slice(0, MAX_QUESTIONS_IN_PROMPT);

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

    const { text: raw, usedModel } = await generateAIText({
      prompt: `你是一位學習分析助手。以下是這位學生答錯的題目，請分析學生可能不熟悉的知識概念，並給予 1-2 句具體的學習建議。

${questionsText}

請只回傳合法 JSON，格式如下（不要加任何說明文字）：
{
  "weakPoints": [
    { "concept": "概念名稱", "suggestion": "具體學習建議" }
  ]
}`,
      maxTokens: 1024,
      json: true,
    });
    console.warn(`[analyze-weak-points] usedModel=${usedModel}`);

    // 提取 JSON 文字
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
