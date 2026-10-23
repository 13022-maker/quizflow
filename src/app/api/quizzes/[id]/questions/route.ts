import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

import { validateImportQuestions } from '@/lib/quiz/questionImportValidation';
import { buildQuestionInsertRows } from '@/lib/quiz/questionRows';
import { db } from '@/libs/DB';
import { questionSchema, quizSchema } from '@/models/Schema';

// 依 CLAUDE.md 規範：所有 API Route 最頂端加 runtime = 'nodejs'
export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  // 驗證登入，批次匯入需要 userId 才能確認測驗所有權
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  const quizId = Number(params.id);
  if (Number.isNaN(quizId)) {
    return NextResponse.json({ error: '無效的測驗 ID' }, { status: 400 });
  }

  // 驗證測驗所有權：先撈 quiz 本身，再比 ownerId。
  // 分開檢查是因為 preview 環境實際遇到「page SSR 查得到、API 卻 404」的詭異情況，
  // 用這個切法能讓 Vercel function log 明確區分「測驗不存在」與「ownership 不符」。
  const [quiz] = await db
    .select({ id: quizSchema.id, ownerId: quizSchema.ownerId })
    .from(quizSchema)
    .where(eq(quizSchema.id, quizId))
    .limit(1);

  if (!quiz) {
    console.warn('[api/quizzes/questions POST] quiz not found', { quizId, userId });
    return NextResponse.json({ error: '找不到測驗' }, { status: 404 });
  }
  if (quiz.ownerId !== userId) {
    console.warn('[api/quizzes/questions POST] ownership mismatch', {
      quizId,
      sessionUserId: userId,
      quizOwnerId: quiz.ownerId,
    });
    return NextResponse.json({ error: '無權限操作此測驗' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.questions)) {
    return NextResponse.json({ error: '匯入資料格式錯誤' }, { status: 400 });
  }
  if (!body.questions.length) {
    return NextResponse.json({ error: '沒有題目可匯入' }, { status: 400 });
  }

  // 逐題驗證：題幹空白、選項格式錯誤的題目剔除（dropped），不寫壞資料進 DB
  const { questions, dropped } = validateImportQuestions(body.questions);
  if (dropped > 0) {
    console.warn('[api/quizzes/questions POST] 剔除格式不完整的題目', { quizId, dropped });
  }
  if (!questions.length) {
    return NextResponse.json({ error: `${dropped} 題格式都不完整，沒有題目可匯入` }, { status: 400 });
  }

  // 取得目前最大 position，讓新題目接在現有題目後面
  const existing = await db
    .select({ position: questionSchema.position })
    .from(questionSchema)
    .where(eq(questionSchema.quizId, quizId));

  const nextPosition = existing.length > 0
    ? Math.max(...existing.map(q => q.position)) + 1
    : 1;

  const rows = buildQuestionInsertRows(questions, quizId, nextPosition);

  // 一次批次插入，減少 DB round-trip
  await db.insert(questionSchema).values(rows);

  // 必須 revalidate，否則編輯頁 server component 即使 router.refresh()
  // 也可能拿到快取中的舊題目列表，前端顯示「題目 (0)」
  revalidatePath(`/dashboard/quizzes/${quizId}/edit`);

  // dropped 為新增欄位（additive），既有只讀 count 的呼叫端不受影響
  return NextResponse.json({ count: rows.length, dropped });
}
