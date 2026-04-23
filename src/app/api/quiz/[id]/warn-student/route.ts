// 老師對特定學生發警告：發 warn event 到 quiz-student:{responseId}
// 學生端有訂此 channel，收到後顯示紅色提醒 overlay
import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { quizSchema, responseSchema } from '@/models/Schema';
import { publishToChannel } from '@/services/live/ablyServer';

export const runtime = 'nodejs';

const BodySchema = z.object({
  responseId: z.number().int().positive(),
  message: z.string().max(200).optional(), // 老師可自訂警告文案；空則用預設
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const quizId = Number(params.id);
  if (!Number.isFinite(quizId) || quizId <= 0) {
    return NextResponse.json({ error: 'Bad quizId' }, { status: 400 });
  }

  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  // 驗 quiz ownership
  const [quiz] = await db
    .select({ ownerId: quizSchema.ownerId })
    .from(quizSchema)
    .where(eq(quizSchema.id, quizId))
    .limit(1);
  if (!quiz) {
    return NextResponse.json({ error: '找不到測驗' }, { status: 404 });
  }
  if (quiz.ownerId !== orgId) {
    return NextResponse.json({ error: '無權限' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? '資料格式錯誤' },
      { status: 400 },
    );
  }

  // 驗 response 屬於此 quiz
  const [row] = await db
    .select({ id: responseSchema.id })
    .from(responseSchema)
    .where(and(
      eq(responseSchema.id, parsed.data.responseId),
      eq(responseSchema.quizId, quizId),
    ))
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: '找不到該學生作答' }, { status: 404 });
  }

  // 發 warn event 到學生專屬 channel
  await publishToChannel(
    `quiz-student:${row.id}`,
    'warn',
    {
      message: parsed.data.message ?? '⚠️ 老師提醒您專心作答',
      ts: Date.now(),
    },
  );

  return NextResponse.json({ ok: true });
}
