import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { ClassAIAnalysis } from '@/features/quiz/ClassAIAnalysis';
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
    .select()
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
    return { question: q, total, correct, rate };
  });

  // 前 3 難題（答對率最低，排除簡答題和作答數為 0 的題目）
  const hardestQuestions = [...questionStats]
    .filter(qs => qs.question.type !== 'short_answer' && qs.rate !== null)
    .sort((a, b) => (a.rate ?? 100) - (b.rate ?? 100))
    .slice(0, 3);

  // 給客戶端元件的序列化資料（Date → ISO string）
  const responseRows: ResponseRow[] = responses.map(r => ({
    id: r.id,
    studentName: r.studentName,
    studentEmail: r.studentEmail,
    score: r.score,
    totalPoints: r.totalPoints,
    submittedAt: r.submittedAt.toISOString(),
  }));

  // 給 AI 分析的題目統計（排除簡答題）
  const aiQuestionStats = questionStats
    .filter(qs => qs.question.type !== 'short_answer' && qs.rate !== null)
    .map(qs => ({ question: qs.question.body, correctRate: qs.rate! }));

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

      {/* 摘要卡片 */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label={t('total_responses')} value={String(totalResponses)} />
        <StatCard
          label={t('avg_score')}
          value={avgScorePercent !== null ? `${avgScorePercent}%` : '—'}
        />
        <StatCard label={t('question_count')} value={String(questions.length)} />
      </div>

      {/* 每題答對率長條圖 */}
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
                        ? <RateBar rate={rate} />
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                  <p className="text-sm font-medium line-clamp-2">{question.body}</p>
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
        <ResultsResponseTable responses={responseRows} />
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

// CSS 長條圖（顏色依答對率變化）
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
