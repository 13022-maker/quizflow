import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { AiQuotaBanner } from '@/features/dashboard/AiQuotaBanner';
import { ClassAIAnalysis } from '@/features/quiz/ClassAIAnalysis';
import type { BreakdownQuestion, BreakdownRow, OptionStats } from '@/features/quiz/QuestionBreakdownTable';
import { QuestionBreakdownTable } from '@/features/quiz/QuestionBreakdownTable';
import type { ResponseRow } from '@/features/quiz/ResultsResponseTable';
import { ResultsResponseTable } from '@/features/quiz/ResultsResponseTable';
import { db } from '@/libs/DB';
import { answerSchema, questionSchema, quizSchema, responseSchema } from '@/models/Schema';

export async function generateMetadata({ params }: { params: { id: string } }) {
  const quizId = Number(params.id);
  if (Number.isNaN(quizId)) {
    return {};
  }
  const [quiz] = await db.select({ title: quizSchema.title }).from(quizSchema).where(eq(quizSchema.id, quizId)).limit(1);
  return { title: quiz ? `成績：${quiz.title}` : '測驗成績' };
}

export default async function QuizResultsPage({ params }: { params: { id: string } }) {
  const t = await getTranslations('QuizResults');
  const { orgId } = await auth();
  if (!orgId) {
    return notFound();
  }

  const quizId = Number(params.id);
  if (Number.isNaN(quizId)) {
    return notFound();
  }

  const [quiz] = await db
    .select({ id: quizSchema.id, title: quizSchema.title })
    .from(quizSchema)
    .where(and(eq(quizSchema.id, quizId), eq(quizSchema.ownerId, orgId)))
    .limit(1);

  if (!quiz) {
    return notFound();
  }

  // 取得所有作答
  const responses = await db
    .select()
    .from(responseSchema)
    .where(eq(responseSchema.quizId, quizId))
    .orderBy(responseSchema.submittedAt);

  // 取得所有題目
  const questions = await db
    .select()
    .from(questionSchema)
    .where(eq(questionSchema.quizId, quizId))
    .orderBy(questionSchema.position);

  // 取得所有答案（join response 確認屬於這份測驗）
  const answers = responses.length > 0
    ? await db
      .select({
        answerId: answerSchema.id,
        responseId: answerSchema.responseId,
        questionId: answerSchema.questionId,
        isCorrect: answerSchema.isCorrect,
        answer: answerSchema.answer,
        gradedAt: answerSchema.gradedAt,
      })
      .from(answerSchema)
      .innerJoin(responseSchema, eq(answerSchema.responseId, responseSchema.id))
      .where(eq(responseSchema.quizId, quizId))
    : [];

  // 計算摘要統計
  const totalResponses = responses.length;
  const scoredResponses = responses.filter(r => r.score !== null && r.totalPoints !== null && r.totalPoints > 0);
  const avgScorePercent = scoredResponses.length > 0
    ? Math.round(scoredResponses.reduce((sum, r) => sum + (r.score! / r.totalPoints!) * 100, 0) / scoredResponses.length)
    : null;

  // 每題統計
  const questionStats = questions.map((q) => {
    const qAnswers = answers.filter(a => a.questionId === q.id);
    const total = qAnswers.length;
    const correct = qAnswers.filter(a => a.isCorrect === true).length;
    const rate = total > 0 ? Math.round((correct / total) * 100) : null;
    // 申論題：統計已批改份數
    const gradedCount = q.type === 'short_answer'
      ? qAnswers.filter(a => a.gradedAt !== null).length
      : 0;
    return { question: q, total, correct, rate, gradedCount };
  });

  // 每個 response 的簡答題批改狀態（判斷待批改 badge）
  const essayStatusByResponseId = new Map<number, { hasEssay: boolean; hasUngradedEssay: boolean }>();
  for (const a of answers) {
    const q = questions.find(qq => qq.id === a.questionId);
    if (!q || q.type !== 'short_answer') {
      continue;
    }
    const entry = essayStatusByResponseId.get(a.responseId) ?? { hasEssay: false, hasUngradedEssay: false };
    entry.hasEssay = true;
    const text
      = typeof a.answer === 'string'
        ? a.answer
        : Array.isArray(a.answer)
          ? a.answer.join(' ')
          : '';
    if (!a.gradedAt && text.trim() !== '') {
      entry.hasUngradedEssay = true;
    }
    essayStatusByResponseId.set(a.responseId, entry);
  }

  // 每題選項分佈：{ [questionId]: { [optionId]: count } }
  // single_choice / true_false 的 answer 是單一 option id 字串
  // multiple_choice 的 answer 是 option id 陣列
  // ranking / short_answer 不統計（展開 UI 也不顯示）
  const optionStats: OptionStats = {};
  for (const a of answers) {
    const stats = (optionStats[a.questionId] ||= {});
    if (Array.isArray(a.answer)) {
      for (const optId of a.answer) {
        stats[optId] = (stats[optId] ?? 0) + 1;
      }
    } else if (typeof a.answer === 'string' && a.answer.length > 0) {
      stats[a.answer] = (stats[a.answer] ?? 0) + 1;
    }
  }

  // 前 3 難題（答對率最低，排除簡答題和作答數為 0 的題目）
  const hardestQuestions = [...questionStats]
    .filter(qs => qs.question.type !== 'short_answer' && qs.rate !== null)
    .sort((a, b) => (a.rate ?? 100) - (b.rate ?? 100))
    .slice(0, 3);

  // 給客戶端元件的序列化資料（Date → ISO string）
  const responseRows: ResponseRow[] = responses.map((r) => {
    const essayStatus = essayStatusByResponseId.get(r.id);
    return {
      id: r.id,
      studentName: r.studentName,
      studentEmail: r.studentEmail,
      score: r.score,
      totalPoints: r.totalPoints,
      leaveCount: r.leaveCount,
      submittedAt: r.submittedAt.toISOString(),
      hasEssay: essayStatus?.hasEssay ?? false,
      hasUngradedEssay: essayStatus?.hasUngradedEssay ?? false,
    };
  });

  // 給 AI 分析的題目統計（排除簡答題）
  const aiQuestionStats = questionStats
    .filter(qs => qs.question.type !== 'short_answer' && qs.rate !== null)
    .map(qs => ({ question: qs.question.body, correctRate: qs.rate! }));

  // 該 quiz 是否有任何簡答題（決定是否顯示批改配額 banner）
  const hasAnyEssay = questions.some(q => q.type === 'short_answer');

  // 給答對率表格客戶端元件的序列化資料（去掉 Date）
  const breakdownRows: BreakdownRow[] = questionStats.map(qs => ({
    question: {
      id: qs.question.id,
      body: qs.question.body,
      type: qs.question.type,
      options: qs.question.options,
      correctAnswers: qs.question.correctAnswers,
    } satisfies BreakdownQuestion,
    total: qs.total,
    correct: qs.correct,
    rate: qs.rate,
    gradedCount: qs.gradedCount,
  }));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* 標題列 */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link
            href={`/dashboard/quizzes/${quiz.id}/edit`}
            className="mb-1 text-sm text-muted-foreground hover:underline"
          >
            ←
            {' '}
            {quiz.title}
          </Link>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
        </div>
      </div>

      {/* AI 批改配額狀態（含 Pro 方案時顯示已用份數；Free 時顯示升級 CTA） */}
      {hasAnyEssay && (
        <div className="mb-6">
          <AiQuotaBanner orgId={orgId} feature="essay_grading" />
        </div>
      )}

      {/* 摘要卡片 */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label={t('total_responses')} value={String(totalResponses)} />
        <StatCard
          label={t('avg_score')}
          value={avgScorePercent !== null ? `${avgScorePercent}%` : '—'}
        />
        <StatCard label={t('question_count')} value={String(questions.length)} />
      </div>

      {/* 每題答對率（含展開選項分佈） */}
      {questions.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">{t('question_breakdown')}</h2>
          <QuestionBreakdownTable
            rows={breakdownRows}
            optionStats={optionStats}
            labels={{
              header_index: '#',
              header_question: t('question_body'),
              header_correct: t('correct_count'),
              header_rate: t('correct_rate'),
              short_answer_note: t('short_answer_note'),
              expand_distribution: '展開選項分佈',
              collapse_distribution: '收合選項分佈',
            }}
          />
        </section>
      )}

      {/* 最難的前 3 題 */}
      {hardestQuestions.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">全班最多人答錯的題目</h2>
          <div className="space-y-2">
            {hardestQuestions.map(({ question, rate }, i) => (
              <div key={question.id} className="flex items-start gap-3 rounded-lg border bg-red-50/60 px-4 py-3">
                <span className="shrink-0 rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
                  第
                  {i + 1}
                  難
                </span>
                <div className="flex-1">
                  <p className="line-clamp-2 text-sm font-medium">{question.body}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    答對率：
                    <span className="font-medium text-red-600">
                      {rate}
                      %
                    </span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* AI 班級整體建議（客戶端元件） */}
      {aiQuestionStats.length > 0 && (
        <section className="mb-8">
          <ClassAIAnalysis quizTitle={quiz.title} questionStats={aiQuestionStats} />
        </section>
      )}

      {/* 學生成績統計表（客戶端元件，支援排序 + CSV 匯出） */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t('response_list')}</h2>
        <ResultsResponseTable responses={responseRows} quizId={quiz.id} />
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-5 py-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
    </div>
  );
}

export const dynamic = 'force-dynamic';
