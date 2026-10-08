/**
 * 匯出靜態練習頁的共用邏輯：撈 quiz/題目、驗證範圍、組 HTML。
 * 被 GET route（下載）與 share/route.ts（上傳 Blob 產生分享連結）共用，
 * 避免兩邊各寫一份 owner 驗證 + 題號範圍處理邏輯。
 */
import { and, asc, eq } from 'drizzle-orm';

import { buildPracticePageHtml, selectPracticeQuestions } from '@/lib/exportPracticePage';
import { db } from '@/libs/DB';
import { questionSchema, quizSchema } from '@/models/Schema';

export type BuildQuizPracticeHtmlResult =
  | {
    ok: true;
    html: string;
    quizTitle: string;
    total: number;
    imported: number;
    skipped: number;
    resolvedStart: number;
    resolvedEnd: number;
  }
  | { ok: false; status: number; error: string };

export async function buildQuizPracticeHtml(
  userId: string,
  quizId: number,
  start: number | undefined,
  end: number | undefined,
): Promise<BuildQuizPracticeHtmlResult> {
  if (Number.isNaN(quizId)) {
    return { ok: false, status: 400, error: 'quizId 不合法' };
  }

  const [quiz] = await db
    .select({ id: quizSchema.id, title: quizSchema.title })
    .from(quizSchema)
    .where(and(eq(quizSchema.id, quizId), eq(quizSchema.ownerId, userId)))
    .limit(1);
  if (!quiz) {
    return { ok: false, status: 404, error: '找不到測驗或無權限' };
  }

  const allQuestions = await db
    .select()
    .from(questionSchema)
    .where(eq(questionSchema.quizId, quizId))
    .orderBy(asc(questionSchema.position));

  if (allQuestions.length === 0) {
    return { ok: false, status: 400, error: '此測驗還沒有題目' };
  }

  const resolvedStart = Math.max(1, start ?? 1);
  const resolvedEnd = Math.min(allQuestions.length, end ?? allQuestions.length);
  if (resolvedStart > resolvedEnd) {
    return { ok: false, status: 400, error: '題號範圍不合法（起始不能大於結束）' };
  }

  const picked = allQuestions.slice(resolvedStart - 1, resolvedEnd);
  const { practiceQuestions, skipped } = selectPracticeQuestions({
    groupLabel: quiz.title,
    questions: picked,
  });

  if (practiceQuestions.length === 0) {
    return { ok: false, status: 400, error: '選取的範圍內沒有可匯出的題目（目前只支援單選題與是非題）' };
  }

  const html = buildPracticePageHtml({
    title: quiz.title,
    kick: 'QuizFlow 測驗匯出．靜態練習頁',
    noteHtml: '<b>免登入、不計時</b>，答題後立即顯示對錯。這份頁面是獨立檔案，離線也能開；把它放到任何網頁空間都能用。',
    questions: practiceQuestions,
  });

  return {
    ok: true,
    html,
    quizTitle: quiz.title,
    total: picked.length,
    imported: practiceQuestions.length,
    skipped,
    resolvedStart,
    resolvedEnd,
  };
}
