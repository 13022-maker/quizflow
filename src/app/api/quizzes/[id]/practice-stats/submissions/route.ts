/**
 * 匯出練習頁線上版學生「確認送出」的成績（CSV）。
 *
 * GET /api/quizzes/[id]/practice-stats/submissions?share=<shareId>
 *
 * 驗證：必須是該 quiz 與該分享連結的 owner（userId 比對，比照 practice-stats/leads 既有寫法）。
 * 欄位：班級、姓名、分數、滿分、答對題數、題數、送出時間（台北時間）、逐題 O/X。
 * 姓名是學生自填的不可信輸入，CSV 產生時已擋公式注入（見 lib/practicePageSubmission.ts submissionsToCsv）。
 */
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { submissionsToCsv } from '@/lib/practicePageSubmission';
import { getPracticePageSubmissions, listOwnedPracticeShares } from '@/libs/practicePageStatsQuery';

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

  const csv = submissionsToCsv(await getPracticePageSubmissions(shareId));
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="practice-page-${shareId}-scores.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
