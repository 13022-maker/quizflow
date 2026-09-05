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
  // \u6A94\u540D\u540C\u6642\u5E36\u7DF4\u7FD2\u6A19\u984C\u8207\u5B78\u79D1\u540D\u7A31\uFF08\u4F8B\u5982\u300C\u8CC7\u8A0A\u4E09\u620A_\u5E38\u6578\u8B8A\u6578\u5BA3\u544A_\u73ED\u7D1A\u6210\u7E3E.csv\u300D\uFF09\uFF0C
  // \u907F\u514D\u540C\u4E00\u73ED\u591A\u500B\u7DF4\u7FD2\uFF08\u4E0D\u540C\u55AE\u5143\uFF09\u90FD\u53EB\u540C\u540D\u6A94\u6848\uFF0C\u4E0B\u8F09\u5F8C\u5206\u4E0D\u6E05\u695A\u662F\u54EA\u4E00\u4EFD
  const safeTitle = practice.title.replace(/[^a-z0-9\u4E00-\u9FFF]/gi, '_');
  // 檔名同時帶練習標題與學科名稱（例如「資訊三戊_常數變數宣告_班級成績.csv」），
  // 避免同一班多個練習（不同單元）都叫同名檔案，下載後分不清楚是哪一份
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
