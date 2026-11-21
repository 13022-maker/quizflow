/**
 * 匯出練習頁結束畫面留下的 email 名單（CSV）。
 *
 * GET /api/quizzes/[id]/practice-stats/leads?share=<shareId>
 *
 * 驗證：必須是該 quiz 與該分享連結的 owner（userId 比對，比照 export-practice-page 既有寫法）。
 * 只輸出 email / 同意時間 / sessionId / shareId，沒有其他個資可輸出。
 */
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { leadsToCsv } from '@/lib/practicePageStats';
import { getPracticePageLeads, listOwnedPracticeShares } from '@/libs/practicePageStatsQuery';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  const quizId = Number(params.id);
  const shareId = Number(new URL(req.url).searchParams.get('share'));
  if (!Number.isInteger(quizId) || !Number.isInteger(shareId)) {
    return NextResponse.json({ error: '參數不合法' }, { status: 400 });
  }

  const shares = await listOwnedPracticeShares(userId, quizId);
  if (!shares.some(s => s.id === shareId)) {
    return NextResponse.json({ error: '找不到分享連結或無權限' }, { status: 404 });
  }

  const csv = leadsToCsv(await getPracticePageLeads(shareId));
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="practice-page-${shareId}-leads.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
