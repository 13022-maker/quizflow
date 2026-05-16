// 學生申訴 AI 評分（不需登入，學生匿名作答）
// 防護：必須提供同一 response 內的 answerId（answer.responseId 必須等於 body.responseId），
// 只允許申訴簡答題（其他題型無 AI 評分）；同一答案可重複送（更新理由）。

import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { answerSchema, questionSchema } from '@/models/Schema';

export const runtime = 'nodejs';

const BodySchema = z.object({
  responseId: z.number().int().positive(),
  answerId: z.number().int().positive(),
  reason: z.string().min(1, '請填寫複審理由').max(500, '理由請少於 500 字'),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '格式錯誤' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? '格式錯誤' },
      { status: 400 },
    );
  }
  const { responseId, answerId, reason } = parsed.data;

  // 1. 驗 answer 屬於該 response（防止亂猜 answerId 申訴別人的答案）
  //    + 確認題型為 short_answer（其他題型沒 AI 評分，沒申訴必要）
  const [row] = await db
    .select({
      id: answerSchema.id,
      questionType: questionSchema.type,
    })
    .from(answerSchema)
    .innerJoin(questionSchema, eq(answerSchema.questionId, questionSchema.id))
    .where(and(eq(answerSchema.id, answerId), eq(answerSchema.responseId, responseId)))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: '找不到此答案' }, { status: 404 });
  }
  if (row.questionType !== 'short_answer') {
    return NextResponse.json({ error: '僅簡答題可申訴' }, { status: 400 });
  }

  // 2. 寫入申訴（同一答案重複送會覆寫 reason 與時間，狀態統一回到 pending）
  await db
    .update(answerSchema)
    .set({
      appealStatus: 'pending',
      appealReason: reason,
      appealCreatedAt: new Date(),
    })
    .where(eq(answerSchema.id, answerId));

  return NextResponse.json({ ok: true });
}
