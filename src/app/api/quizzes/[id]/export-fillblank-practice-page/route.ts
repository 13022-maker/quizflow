/**
 * 匯出測驗的填空題為獨立的靜態填空練習頁 HTML（免登入、不計時）
 *
 * GET /api/quizzes/[id]/export-fillblank-practice-page?start=1&end=20
 *   start/end 為題號範圍（1-based、含頭尾），不帶時預設整份測驗
 *
 * 只支援 AI 出題的「填空題」（存成 short_answer，body 含 ___ 標記），其他題型
 * 會直接略過，不會讓整份匯出失敗；略過的題數用 X-Export-Skipped header 回報。
 *
 * 驗證：必須是該 quiz 的 owner（userId 比對），比照 export-practice-page/route.ts
 *
 * 撈資料/組 HTML 的邏輯跟 share/route.ts（產生分享連結）共用，見 shared.ts
 */
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { buildQuizFillBlankPracticeHtml } from './shared';

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
  const { searchParams } = new URL(req.url);
  const startRaw = Number.parseInt(searchParams.get('start') ?? '', 10);
  const endRaw = Number.parseInt(searchParams.get('end') ?? '', 10);

  const result = await buildQuizFillBlankPracticeHtml(
    userId,
    quizId,
    Number.isNaN(startRaw) ? undefined : startRaw,
    Number.isNaN(endRaw) ? undefined : endRaw,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const safeTitle = result.quizTitle.replace(/[\\/:*?"<>|]/g, '_');
  const filename = encodeURIComponent(`${safeTitle}_填空練習頁.html`);

  return new NextResponse(result.html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
      'X-Export-Total': String(result.total),
      'X-Export-Imported': String(result.imported),
      'X-Export-Skipped': String(result.skipped),
    },
  });
}
