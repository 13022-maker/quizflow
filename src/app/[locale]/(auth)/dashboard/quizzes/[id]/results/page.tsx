import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

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
    .select()
    .from(quizSchema)
    .where(and(eq(quizSchema.id, quizId), eq(quizSchema.ownerId, orgId)))
    .limit(1);

  if (!quiz) {
    return notFound();
  }

  // Fetch all responses
  const responses = await db
    .select()
    .from(responseSchema)
    .where(eq(responseSchema.quizId, quizId))
    .orderBy(responseSchema.submittedAt);

  // Fetch all questions
  const questions = await db
    .select()
    .from(questionSchema)
    .where(eq(questionSchema.quizId, quizId))
    .orderBy(questionSchema.position);

  // Fetch all answers for this quiz (via join)
  const answers = responses.length > 0
    ? await db
      .select({
        answerId: answerSchema.id,
        responseId: answerSchema.responseId,
        questionId: answerSchema.questionId,
        isCorrect: answerSchema.isCorrect,
      })
      .from(answerSchema)
      .innerJoin(responseSchema, eq(answerSchema.responseId, responseSchema.id))
      .where(eq(responseSchema.quizId, quizId))
    : [];

  // Compute summary stats
  const totalResponses = responses.length;
  const scoredResponses = responses.filter(r => r.score !== null && r.totalPoints !== null && r.totalPoints > 0);
  const avgScorePercent = scoredResponses.length > 0
    ? Math.round(scoredResponses.reduce((sum, r) => sum + (r.score! / r.totalPoints!) * 100, 0) / scoredResponses.length)
    : null;

  // Per-question stats
  const questionStats = questions.map((q) => {
    const qAnswers = answers.filter(a => a.questionId === q.id);
    const total = qAnswers.length;
    const correct = qAnswers.filter(a => a.isCorrect === true).length;
    const rate = total > 0 ? Math.round((correct / total) * 100) : null;
    return { question: q, total, correct, rate };
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Header */}
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

      {/* Summary cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label={t('total_responses')} value={String(totalResponses)} />
        <StatCard
          label={t('avg_score')}
          value={avgScorePercent !== null ? `${avgScorePercent}%` : '—'}
        />
        <StatCard label={t('question_count')} value={String(questions.length)} />
      </div>

      {/* Per-question breakdown */}
      {questions.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">{t('question_breakdown')}</h2>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">#</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">{t('question_body')}</th>
                  <th className="px-4 py-2 text-center font-medium text-muted-foreground">{t('correct_count')}</th>
                  <th className="px-4 py-2 text-center font-medium text-muted-foreground">{t('correct_rate')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {questionStats.map(({ question, total, correct, rate }, i) => (
                  <tr key={question.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 text-muted-foreground">{i + 1}</td>
                    <td className="px-4 py-3">
                      <p className="line-clamp-2">{question.body}</p>
                      {question.type === 'short_answer' && (
                        <span className="mt-0.5 text-xs text-muted-foreground">{t('short_answer_note')}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {question.type === 'short_answer' ? '—' : `${correct} / ${total}`}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {rate !== null && question.type !== 'short_answer'
                        ? (
                            <RateBar rate={rate} />
                          )
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Response list */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t('response_list')}</h2>
        {responses.length === 0
          ? (
              <p className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
                {t('no_responses')}
              </p>
            )
          : (
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-muted-foreground">{t('student_name')}</th>
                      <th className="px-4 py-2 text-left font-medium text-muted-foreground">{t('student_email')}</th>
                      <th className="px-4 py-2 text-center font-medium text-muted-foreground">{t('score')}</th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">{t('submitted_at')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {responses.map(r => (
                      <tr key={r.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3">{r.studentName || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-4 py-3">{r.studentEmail || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-4 py-3 text-center">
                          {r.score !== null && r.totalPoints !== null
                            ? `${r.score} / ${r.totalPoints}`
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-muted-foreground">
                          {r.submittedAt.toLocaleString('zh-TW')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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

function RateBar({ rate }: { rate: number }) {
  const color = rate >= 70 ? 'bg-green-500' : rate >= 40 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center justify-center gap-2">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${rate}%` }} />
      </div>
      <span className="w-9 text-right text-xs font-medium">
        {rate}
        %
      </span>
    </div>
  );
}

export const dynamic = 'force-dynamic';
