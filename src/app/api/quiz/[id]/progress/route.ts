// 學生作答進度回報（public endpoint，用 studentToken 驗身分）
// 觸發時機：QuizTaker 偵測 currentQuestionIndex 變動或離開/回來頁面時
// 更新 response.lastAnsweredQuestionIndex + leaveCount，並發 tick 通知監考牆
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { responseSchema } from '@/models/Schema';
import { publishToChannel } from '@/services/live/ablyServer';

export const runtime = 'nodejs';

const BodySchema = z.object({
  studentToken: z.string().min(1),
  // 以下都是 optional，各自變動時才帶
  questionIndex: z.number().int().min(0).optional(),
  leaveCount: z.number().int().min(0).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const quizId = Number(params.id);
  if (!Number.isFinite(quizId) || quizId <= 0) {
    return NextResponse.json({ error: 'Bad quizId' }, { status: 400 });
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

  // 驗 studentToken 對應此 quizId 的 response row
  const [row] = await db
    .select({
      id: responseSchema.id,
      status: responseSchema.status,
    })
    .from(responseSchema)
    .where(and(
      eq(responseSchema.quizId, quizId),
      eq(responseSchema.studentToken, parsed.data.studentToken),
    ))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: '身分驗證失敗' }, { status: 401 });
  }
  if (row.status === 'submitted') {
    return NextResponse.json({ error: '作答已結束' }, { status: 409 });
  }

  // 動態組 update payload（只更新帶進來的欄位）
  const updates: Partial<{
    lastAnsweredQuestionIndex: number;
    leaveCount: number;
  }> = {};
  if (parsed.data.questionIndex !== undefined) {
    updates.lastAnsweredQuestionIndex = parsed.data.questionIndex;
  }
  if (parsed.data.leaveCount !== undefined) {
    updates.leaveCount = parsed.data.leaveCount;
  }

  if (Object.keys(updates).length > 0) {
    await db
      .update(responseSchema)
      .set(updates)
      .where(eq(responseSchema.id, row.id));
  }

  // 通知監考牆即時更新
  await publishToChannel(`quiz-proctor:${quizId}`, 'tick', { ts: Date.now() });

  return NextResponse.json({ ok: true });
}
