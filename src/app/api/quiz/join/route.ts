import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { quizSchema } from '@/models/Schema';

export const runtime = 'nodejs';

// 學生用 6 碼房間碼查找測驗並 redirect 到作答頁
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code')?.trim().toUpperCase();

  if (!code || code.length !== 6) {
    return NextResponse.json({ error: '請輸入 6 碼房間碼' }, { status: 400 });
  }

  const [quiz] = await db
    .select({ accessCode: quizSchema.accessCode, status: quizSchema.status, expiresAt: quizSchema.expiresAt })
    .from(quizSchema)
    .where(eq(quizSchema.roomCode, code))
    .limit(1);

  if (!quiz || !quiz.accessCode) {
    return NextResponse.json({ error: '找不到此房間碼對應的測驗' }, { status: 404 });
  }

  if (quiz.status !== 'published') {
    return NextResponse.json({ error: '此測驗尚未發佈或已關閉' }, { status: 403 });
  }

  // 檢查到期時間
  if (quiz.expiresAt && new Date() > quiz.expiresAt) {
    return NextResponse.json({ error: '此測驗連結已過期' }, { status: 403 });
  }

  // redirect 到學生作答頁
  return NextResponse.redirect(new URL(`/quiz/${quiz.accessCode}`, request.url));
}
