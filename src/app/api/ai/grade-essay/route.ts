// 申論題 / 作文 AI 批改 API Route
// 依 rubric（評分量表）呼叫 Claude，回傳四面向分數 + 整體評語 + 逐句回饋
import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { checkAndIncrementAiUsage } from '@/actions/aiUsageActions';
import { anthropic, CLAUDE_MODEL } from '@/lib/ai/client';
import {
  buildEssayGradingUserPrompt,
  DEFAULT_ESSAY_RUBRIC,
  ESSAY_GRADING_SYSTEM_PROMPT,
  EssayGradingResultSchema,
} from '@/lib/ai/prompts';
import { db } from '@/libs/DB';
import { isProOrAbove } from '@/libs/Plan';
import {
  answerSchema,
  questionSchema,
  quizSchema,
  responseSchema,
} from '@/models/Schema';

export const runtime = 'nodejs';
export const maxDuration = 60;

const InputSchema = z.object({
  answerId: z.number().int().positive(),
});

export async function POST(request: Request) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  // Pro 方案限定
  if (!(await isProOrAbove(orgId))) {
    return NextResponse.json({ error: 'PRO_REQUIRED' }, { status: 403 });
  }

  // 解析 body
  const body = await request.json().catch(() => null);
  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '格式錯誤' }, { status: 400 });
  }
  const { answerId } = parsed.data;

  // 讀取 answer + question + quiz（同 orgId 才放行）
  const rows = await db
    .select({
      answerId: answerSchema.id,
      studentAnswer: answerSchema.answer,
      questionBody: questionSchema.body,
      questionType: questionSchema.type,
      rubric: questionSchema.rubric,
      questionPoints: questionSchema.points,
      quizOwnerId: quizSchema.ownerId,
    })
    .from(answerSchema)
    .innerJoin(questionSchema, eq(answerSchema.questionId, questionSchema.id))
    .innerJoin(responseSchema, eq(answerSchema.responseId, responseSchema.id))
    .innerJoin(quizSchema, eq(responseSchema.quizId, quizSchema.id))
    .where(and(eq(answerSchema.id, answerId), eq(quizSchema.ownerId, orgId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: '找不到作答記錄' }, { status: 404 });
  }
  if (row.questionType !== 'short_answer') {
    return NextResponse.json({ error: '僅支援簡答題批改' }, { status: 400 });
  }

  const studentText
    = typeof row.studentAnswer === 'string'
      ? row.studentAnswer
      : Array.isArray(row.studentAnswer)
        ? row.studentAnswer.join(' ')
        : '';

  if (!studentText.trim()) {
    return NextResponse.json({ error: '學生答案為空，無法批改' }, { status: 400 });
  }

  // 檢查 + 遞增配額（essay_grading）
  const quota = await checkAndIncrementAiUsage(orgId, 'essay_grading');
  if (!quota.allowed) {
    return NextResponse.json({ error: 'QUOTA_EXCEEDED', reason: quota.reason }, { status: 429 });
  }

  const rubric = row.rubric ?? DEFAULT_ESSAY_RUBRIC;

  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      system: ESSAY_GRADING_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildEssayGradingUserPrompt({
            question: row.questionBody,
            rubric,
            studentAnswer: studentText,
          }),
        },
      ],
    });

    const firstBlock = message.content[0];
    const raw
      = firstBlock && 'text' in firstBlock
        ? (firstBlock as { text: string }).text
        : '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return NextResponse.json({ error: 'AI 回傳格式錯誤' }, { status: 500 });
    }

    const parsedJson = JSON.parse(match[0]);
    const validated = EssayGradingResultSchema.safeParse(parsedJson);
    if (!validated.success) {
      return NextResponse.json({ error: 'AI 回傳結構不符', detail: validated.error.flatten() }, { status: 500 });
    }

    return NextResponse.json({
      result: validated.data,
      questionPoints: row.questionPoints,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知錯誤';
    return NextResponse.json({ error: `批改失敗：${msg}` }, { status: 500 });
  }
}
