// 監考牆 / 學生警告用 Ably token 發行
//   - host（老師）：驗 Clerk orgId 擁有 quiz → 訂閱 quiz-proctor:{quizId}
//   - student：驗 studentToken 對應此 quiz → 訂閱自己的 quiz-student:{responseId}
// 兩種 role 都只能 subscribe、不能 publish（publish 只在 server 端）
import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { quizSchema, responseSchema } from '@/models/Schema';
import { createTokenRequest, isAblyEnabled } from '@/services/live/ablyServer';

export const runtime = 'nodejs';

const HostQuery = z.object({
  role: z.literal('host'),
});

const StudentQuery = z.object({
  role: z.literal('student'),
  studentToken: z.string().min(1),
});

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  if (!isAblyEnabled()) {
    return NextResponse.json(
      { error: 'Ably 未啟用（ABLY_API_KEY 未設定）' },
      { status: 503 },
    );
  }

  const quizId = Number(params.id);
  if (!Number.isFinite(quizId) || quizId <= 0) {
    return NextResponse.json({ error: 'Bad quizId' }, { status: 400 });
  }

  const url = new URL(request.url);
  const queryParams = Object.fromEntries(url.searchParams.entries());

  // Host 端：驗 Clerk + quiz ownership → 訂閱 quiz-proctor:{quizId}
  if (queryParams.role === 'host') {
    const parsed = HostQuery.safeParse(queryParams);
    if (!parsed.success) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }
    const { orgId, userId } = await auth();
    if (!orgId || !userId) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }
    const [quiz] = await db
      .select({ ownerId: quizSchema.ownerId })
      .from(quizSchema)
      .where(eq(quizSchema.id, quizId))
      .limit(1);
    if (!quiz || quiz.ownerId !== orgId) {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }
    const tokenRequest = await createTokenRequest({
      clientId: `proctor:${orgId}:${quizId}`,
      capability: {
        [`quiz-proctor:${quizId}`]: ['subscribe'],
      },
    });
    return NextResponse.json(tokenRequest);
  }

  // Student 端：驗 studentToken → 訂閱自己的 quiz-student:{responseId}
  if (queryParams.role === 'student') {
    const parsed = StudentQuery.safeParse(queryParams);
    if (!parsed.success) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }
    const [row] = await db
      .select({ id: responseSchema.id })
      .from(responseSchema)
      .where(and(
        eq(responseSchema.quizId, quizId),
        eq(responseSchema.studentToken, parsed.data.studentToken),
      ))
      .limit(1);
    if (!row) {
      return NextResponse.json({ error: '身分驗證失敗' }, { status: 403 });
    }
    const tokenRequest = await createTokenRequest({
      clientId: `student:${quizId}:${row.id}`,
      capability: {
        [`quiz-student:${row.id}`]: ['subscribe'],
      },
    });
    return NextResponse.json(tokenRequest);
  }

  return NextResponse.json({ error: 'role 必須為 host 或 student' }, { status: 400 });
}
