import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { buildClassScoreReport } from '@/libs/adaptive/classScoreReport';
import { parseDateRangeParams } from '@/libs/adaptive/dateRangeFilter';
import { getAdaptiveService } from '@/libs/adaptive/service';
import { db } from '@/libs/DB';
import { adaptivePracticeSchema } from '@/models/Schema';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: { practiceId: string } },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  const practiceId = Number(params.practiceId);
  if (!Number.isInteger(practiceId)) {
    return NextResponse.json({ error: '無效的練習 ID' }, { status: 400 });
  }

  const [practice] = await db
    .select()
    .from(adaptivePracticeSchema)
    .where(
      and(
        eq(adaptivePracticeSchema.id, practiceId),
        eq(adaptivePracticeSchema.ownerId, userId),
      ),
    )
    .limit(1);

  if (!practice) {
    return NextResponse.json({ error: '找不到練習或無權限' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const dateRange = parseDateRangeParams({
    start: searchParams.get('start') ?? undefined,
    end: searchParams.get('end') ?? undefined,
  });

  const { header, rows } = await buildClassScoreReport(practice, dateRange);
  const service = await getAdaptiveService(practice.id, practice.subjectId);

  const csvContent = [header, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const bom = '\uFEFF';
  // 檔名同時帶練習標題與學科名稱（例如「資訊三戊_常數變數宣告_班級成績.csv」），
  // 避免同一班多個練習（不同單元）都叫同名檔案，下載後分不清楚是哪一份
  const safeTitle = practice.title.replace(/[^a-z0-9\u4E00-\u9FFF]/gi, '_');
  // CJK Unified Ideographs: U+4E00-U+9FFF（同 safeTitle 的字元範圍，見 src/lib/cloze.ts CJK_PHRASE 前例）
  // eslint-disable-next-line regexp/no-obscure-range
  const safeSubject = service.subject.name.replace(/[^a-z0-9一-鿿]/gi, '_');
  const filename = `${safeTitle}_${safeSubject}_班級成績.csv`;

  return new Response(bom + csvContent, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
