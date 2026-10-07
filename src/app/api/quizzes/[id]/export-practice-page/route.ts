/**
 * 匯出測驗為獨立的靜態練習頁 HTML（免登入、不計時、答題立即顯示對錯）
 *
 * GET /api/quizzes/[id]/export-practice-page?start=1&end=20
 *   start/end 為題號範圍（1-based、含頭尾），不帶時預設整份測驗
 *
 * 只支援單選題(single_choice)跟是非題(true_false)——排序題/簡答題/克漏字/
 * 聽力題/多選題沒辦法套進「四選一、單一正解」的靜態頁互動邏輯，遇到會直接
 * 略過那一題，不會讓整份匯出失敗；略過的題數用 X-Export-Skipped header 回報。
 *
 * 詳解(explanation)若題目有存就會帶進去；AI 出題時有生成才會存,老師手動新增
 * 的題目通常是 null,匯出的靜態頁那種題目答錯時就只顯示「正確答案是 X」。
 *
 * 驗證：必須是該 quiz 的 owner（userId 比對），比照 export/route.ts 既有寫法
 *
 * 撈資料/組 HTML 的邏輯跟 share/route.ts（產生分享連結）共用，見 shared.ts
 */
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { buildQuizPracticeHtml } from './shared';

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

  const result = await buildQuizPracticeHtml(
    userId,
    quizId,
    Number.isNaN(startRaw) ? undefined : startRaw,
    Number.isNaN(endRaw) ? undefined : endRaw,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const safeTitle = result.quizTitle.replace(/[\\/:*?"<>|]/g, '_');
  const filename = encodeURIComponent(`${safeTitle}_練習頁.html`);

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
