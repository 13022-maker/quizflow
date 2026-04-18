import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { quizSchema, responseSchema } from '@/models/Schema';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  const quizId = Number(params.id);
  if (Number.isNaN(quizId)) {
    return NextResponse.json({ error: '無效的測驗 ID' }, { status: 400 });
  }

  const [quiz] = await db
    .select({ id: quizSchema.id, title: quizSchema.title })
    .from(quizSchema)
    .where(and(eq(quizSchema.id, quizId), eq(quizSchema.ownerId, orgId)))
    .limit(1);

  if (!quiz) {
    return NextResponse.json({ error: '找不到測驗或無權限' }, { status: 404 });
  }

  const responses = await db
    .select()
    .from(responseSchema)
    .where(eq(responseSchema.quizId, quizId))
    .orderBy(responseSchema.submittedAt);

  const header = ['姓名', 'Email', '答對題數', '答對率', '離開次數', '作答時間'];
  const rows = responses.map((r) => {
    const rate = r.score !== null && r.totalPoints !== null && r.totalPoints > 0
      ? `${Math.round((r.score / r.totalPoints) * 100)}%`
      : '—';
    return [
      r.studentName ?? '',
      r.studentEmail ?? '',
      r.score !== null && r.totalPoints !== null ? `${r.score}/${r.totalPoints}` : '—',
      rate,
      String(r.leaveCount),
      r.submittedAt.toLocaleString('zh-TW'),
    ];
  });

  const csvContent = [header, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const bom = '\uFEFF';
  const safeTitle = quiz.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
  const filename = `${safeTitle}_成績.csv`;

  return new Response(bom + csvContent, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
