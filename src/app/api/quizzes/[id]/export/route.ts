/**
 * 匯出測驗為 Word (.docx)
 *
 * GET /api/quizzes/[id]/export?variant=teacher|student
 *   - teacher：含答案 + 配分
 *   - student：只有題目（空白作答卷）
 *
 * 驗證：必須是該 quiz 的 owner（orgId 比對）
 */

import { auth } from '@clerk/nextjs/server';
import { and, asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { generateQuizDocx } from '@/libs/quizExport';
import { questionSchema, quizSchema } from '@/models/Schema';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  const quizId = Number(params.id);
  if (Number.isNaN(quizId)) {
    return NextResponse.json({ error: 'quizId 不合法' }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const variantRaw = searchParams.get('variant') ?? 'teacher';
  const variant = variantRaw === 'student' ? 'student' : 'teacher';

  // 驗證所有權
  const [quiz] = await db
    .select()
    .from(quizSchema)
    .where(and(eq(quizSchema.id, quizId), eq(quizSchema.ownerId, orgId)))
    .limit(1);
  if (!quiz) {
    return NextResponse.json({ error: '找不到測驗或無權限' }, { status: 404 });
  }

  const questions = await db
    .select()
    .from(questionSchema)
    .where(eq(questionSchema.quizId, quizId))
    .orderBy(asc(questionSchema.position));

  if (questions.length === 0) {
    return NextResponse.json({ error: '此測驗還沒有題目' }, { status: 400 });
  }

  const buffer = await generateQuizDocx(quiz, questions, variant);

  // 檔名安全化（Windows 不允許 \ / : * ? " < > |）
  const safeTitle = quiz.title.replace(/[\\/:*?"<>|]/g, '_');
  const suffix = variant === 'teacher' ? '老師版' : '學生版';
  const filename = encodeURIComponent(`${safeTitle}_${suffix}.docx`);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
