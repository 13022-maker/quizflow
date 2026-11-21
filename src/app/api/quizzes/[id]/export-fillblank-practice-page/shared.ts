/**
 * 匯出靜態填空練習頁的共用邏輯：撈 quiz/題目、驗證範圍、組 HTML。
 * 被 GET route（下載）與 share/route.ts（上傳 Blob 產生分享連結）共用，比照
 * export-practice-page/shared.ts 的寫法。
 */
import { and, asc, eq } from 'drizzle-orm';

import { buildFillBlankPracticePageHtml, selectFillBlankQuestions } from '@/lib/exportFillBlankPracticePage';
import { buildFillBlankAnswerKey, type FillBlankAnswerKey } from '@/lib/practicePageSubmission';
import { db } from '@/libs/DB';
import { questionSchema, quizSchema } from '@/models/Schema';

// 看一次答案扣該格幾 %：HTML 與答案表必須用同一個值，server 重算分數才會跟頁面上一致
const HINT_PENALTY_PERCENT = 3;

export type BuildQuizFillBlankPracticeHtmlResult =
  | {
    ok: true;
    html: string;
    answerKey: FillBlankAnswerKey; // 跟 html 同一份題目資料產生，分享連結存進 DB 給「確認送出」server 重算分數
    quizTitle: string;
    total: number;
    imported: number;
    skipped: number;
    resolvedStart: number;
    resolvedEnd: number;
  }
  | { ok: false; status: number; error: string };

export async function buildQuizFillBlankPracticeHtml(
  userId: string,
  quizId: number,
  start: number | undefined,
  end: number | undefined,
): Promise<BuildQuizFillBlankPracticeHtmlResult> {
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
  const { practiceQuestions, skipped } = selectFillBlankQuestions({
    groupLabel: quiz.title,
    questions: picked,
  });

  if (practiceQuestions.length === 0) {
    return { ok: false, status: 400, error: '選取的範圍內沒有可匯出的填空題（只支援 AI 出題的填空題，body 需含 ___ 標記）' };
  }

  const html = buildFillBlankPracticePageHtml({
    title: quiz.title,
    kick: 'QuizFlow 測驗匯出．填空練習頁',
    questions: practiceQuestions,
    hintPenaltyPercent: HINT_PENALTY_PERCENT,
  });

  return {
    ok: true,
    html,
    answerKey: buildFillBlankAnswerKey(practiceQuestions, HINT_PENALTY_PERCENT),
    quizTitle: quiz.title,
    total: picked.length,
    imported: practiceQuestions.length,
    skipped,
    resolvedStart,
    resolvedEnd,
  };
}
