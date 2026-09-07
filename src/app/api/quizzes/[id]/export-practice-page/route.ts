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
 */
import { auth } from '@clerk/nextjs/server';
import { and, asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { buildPracticePageHtml, type PracticePageQuestion } from '@/lib/exportPracticePage';
import { db } from '@/libs/DB';
import { questionSchema, quizSchema } from '@/models/Schema';

export const runtime = 'nodejs';

const SUPPORTED_TYPES = new Set(['single_choice', 'true_false']);

// 是非題在 DB 沒存 options 時，作答頁本來就會自動補上這組預設選項（見
// CLAUDE.md「是非題作答」bug fix 記錄），匯出時要對齊同一套預設，不然會漏題。
const DEFAULT_TF_OPTIONS = [
  { id: 'tf-true', text: '正確' },
  { id: 'tf-false', text: '錯誤' },
];

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  const quizId = Number(params.id);
  if (Number.isNaN(quizId)) {
    return NextResponse.json({ error: 'quizId 不合法' }, { status: 400 });
  }

  const [quiz] = await db
    .select({ id: quizSchema.id, title: quizSchema.title })
    .from(quizSchema)
    .where(and(eq(quizSchema.id, quizId), eq(quizSchema.ownerId, userId)))
    .limit(1);
  if (!quiz) {
    return NextResponse.json({ error: '找不到測驗或無權限' }, { status: 404 });
  }

  const allQuestions = await db
    .select()
    .from(questionSchema)
    .where(eq(questionSchema.quizId, quizId))
    .orderBy(asc(questionSchema.position));

  if (allQuestions.length === 0) {
    return NextResponse.json({ error: '此測驗還沒有題目' }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const startRaw = Number.parseInt(searchParams.get('start') ?? '1', 10);
  const endRaw = Number.parseInt(searchParams.get('end') ?? String(allQuestions.length), 10);
  const start = Math.max(1, Number.isNaN(startRaw) ? 1 : startRaw);
  const end = Math.min(allQuestions.length, Number.isNaN(endRaw) ? allQuestions.length : endRaw);
  if (start > end) {
    return NextResponse.json({ error: '題號範圍不合法（起始不能大於結束）' }, { status: 400 });
  }

  const picked = allQuestions.slice(start - 1, end);
  const practiceQuestions: PracticePageQuestion[] = [];
  let skipped = 0;

  for (const q of picked) {
    if (!SUPPORTED_TYPES.has(q.type)) {
      skipped++;
      continue;
    }
    const options = q.options?.length ? q.options : (q.type === 'true_false' ? DEFAULT_TF_OPTIONS : null);
    const correctId = q.correctAnswers?.[0];
    const correctIndex = options && correctId ? options.findIndex(o => o.id === correctId) : -1;
    if (!options || correctIndex === -1) {
      skipped++;
      continue;
    }

    practiceQuestions.push({
      groupLabel: quiz.title,
      question: q.body,
      image: q.imageUrl ? `<img src="${q.imageUrl.replace(/"/g, '&quot;')}">` : false,
      options: options.map(o => o.text),
      correctIndex,
      explanation: q.explanation ?? undefined,
    });
  }

  if (practiceQuestions.length === 0) {
    return NextResponse.json(
      { error: '選取的範圍內沒有可匯出的題目（目前只支援單選題與是非題）' },
      { status: 400 },
    );
  }

  const html = buildPracticePageHtml({
    title: quiz.title,
    kick: 'QuizFlow 測驗匯出．靜態練習頁',
    noteHtml: '<b>免登入、不計時</b>，答題後立即顯示對錯。這份頁面是獨立檔案，離線也能開；把它放到任何網頁空間都能用。',
    questions: practiceQuestions,
  });

  const safeTitle = quiz.title.replace(/[\\/:*?"<>|]/g, '_');
  const filename = encodeURIComponent(`${safeTitle}_練習頁.html`);

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
      'X-Export-Total': String(picked.length),
      'X-Export-Imported': String(practiceQuestions.length),
      'X-Export-Skipped': String(skipped),
    },
  });
}
