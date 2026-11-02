import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { db } from '@/libs/DB';
import { getPracticePageStats, listOwnedPracticeShares } from '@/libs/practicePageStatsQuery';
import { quizSchema } from '@/models/Schema';

/**
 * 靜態練習頁（/api/p/[id]）的匿名作答統計：作答次數、完成率、平均分、
 * 各題錯誤率與選項分布、依 utm_content 分來源、自我回報分布、email 名單匯出。
 * 驗證：quiz 與分享連結都必須屬於目前登入的老師（userId 比對，比照 export-practice-page）。
 */
export default async function PracticeStatsPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { share?: string };
}) {
  const t = await getTranslations('PracticeStats');
  const { userId } = await auth();
  if (!userId) {
    return notFound();
  }

  const quizId = Number(params.id);
  if (!Number.isInteger(quizId)) {
    return notFound();
  }

  const [quiz] = await db
    .select({ id: quizSchema.id, title: quizSchema.title })
    .from(quizSchema)
    .where(and(eq(quizSchema.id, quizId), eq(quizSchema.ownerId, userId)))
    .limit(1);
  if (!quiz) {
    return notFound();
  }

  const shares = await listOwnedPracticeShares(userId, quizId);
  const requestedShareId = Number(searchParams.share);
  const share = shares.find(s => s.id === requestedShareId) ?? shares[0];

  const header = (
    <div className="mb-6">
      <Link href={`/dashboard/quizzes/${quiz.id}/edit`} className="mb-1 text-sm text-muted-foreground hover:underline">
        ←
        {' '}
        {quiz.title}
      </Link>
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="mt-1 text-xs text-muted-foreground">{t('privacy_note')}</p>
    </div>
  );

  if (!share) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        {header}
        <p className="rounded-xl border bg-muted/40 p-6 text-sm text-muted-foreground">{t('no_shares')}</p>
      </div>
    );
  }

  const stats = await getPracticePageStats(share.id, quizId);
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  const roleLabel = (v: string | null) => (v ? t(`role_${v}` as 'role_teacher') : t('not_answered'));
  const languageLabel = (v: string | null) => (v ? t(`language_${v}` as 'language_cpp') : t('not_answered'));
  const examPlanLabel = (v: string | null) => (v ? t(`exam_plan_${v}` as 'exam_plan_soon') : t('not_answered'));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {header}

      {/* 分享連結切換 */}
      {shares.length > 1 && (
        <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('share_label')}</span>
          {shares.map(s => (
            <Link
              key={s.id}
              href={`/dashboard/quizzes/${quiz.id}/practice-stats?share=${s.id}`}
              className={`rounded-full border px-3 py-1 ${s.id === share.id ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
            >
              {t('share_item', { id: s.id, range: s.questionRange })}
            </Link>
          ))}
        </div>
      )}

      {/* 摘要卡片 */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label={t('sessions')} value={String(stats.sessions)} />
        <StatCard label={t('completion_rate')} value={stats.sessions > 0 ? pct(stats.completionRate) : '—'} />
        <StatCard
          label={t('avg_score')}
          value={stats.avgCorrect !== null && stats.avgAnswered
            ? t('avg_score_value', { correct: stats.avgCorrect.toFixed(1), total: Math.round(stats.avgAnswered) })
            : '—'}
        />
        <StatCard label={t('leads')} value={String(stats.leadCount)}>
          {stats.leadCount > 0 && (
            <a
              href={`/api/quizzes/${quiz.id}/practice-stats/leads?share=${share.id}`}
              className="mt-2 inline-block text-xs text-primary underline"
            >
              {t('export_leads')}
            </a>
          )}
        </StatCard>
      </div>

      {stats.sessions === 0
        ? <p className="rounded-xl border bg-muted/40 p-6 text-sm text-muted-foreground">{t('empty')}</p>
        : (
            <>
              {/* 各題錯誤率 */}
              <section className="mb-8">
                <h2 className="mb-3 text-lg font-semibold">{t('question_breakdown')}</h2>
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">{t('col_question')}</th>
                        <th className="px-3 py-2">{t('col_error_rate')}</th>
                        <th className="px-3 py-2 text-right">{t('col_attempts')}</th>
                        <th className="px-3 py-2">{t('col_distribution')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.questions.map(q => (
                        <tr key={q.questionIndex} className="border-t align-top">
                          <td className="max-w-[260px] px-3 py-2">
                            <div className="font-medium">{t('question_number', { n: q.questionIndex + 1 })}</div>
                            <div className="line-clamp-2 text-xs text-muted-foreground">
                              {q.body ?? t('question_missing')}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-16 overflow-hidden rounded-full bg-muted">
                                <div className="h-full bg-red-500" style={{ width: pct(q.errorRate) }} />
                              </div>
                              <span className="tabular-nums">{pct(q.errorRate)}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{q.attempts}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {q.distribution.map((d) => {
                                const isTopWrong = d.option === q.topWrongOption;
                                const optionText = q.optionTexts[d.option];
                                return (
                                  <span
                                    key={d.option}
                                    title={[
                                      optionText ?? t('option_n', { n: d.option + 1 }),
                                      isTopWrong ? t('most_picked_wrong') : '',
                                    ].filter(Boolean).join(' — ')}
                                    className={`rounded-md border px-1.5 py-0.5 text-xs tabular-nums ${
                                      d.isCorrect
                                        ? 'border-green-300 bg-green-50 text-green-800'
                                        : isTopWrong
                                          ? 'border-red-400 bg-red-100 font-semibold text-red-800'
                                          : 'border-gray-200 text-gray-600'
                                    }`}
                                  >
                                    {d.isCorrect ? '✓ ' : isTopWrong ? '⚠ ' : ''}
                                    {d.option + 1}
                                    ：
                                    {d.count}
                                  </span>
                                );
                              })}
                            </div>
                            {q.topWrongOption !== null && q.optionTexts[q.topWrongOption] && (
                              <div className="mt-1 line-clamp-1 text-xs text-red-700">
                                {t('most_picked_wrong')}
                                ：
                                {q.optionTexts[q.topWrongOption]}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* 依來源影片 */}
              <section className="mb-8">
                <h2 className="mb-3 text-lg font-semibold">{t('by_utm')}</h2>
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">{t('col_utm')}</th>
                        <th className="px-3 py-2 text-right">{t('sessions')}</th>
                        <th className="px-3 py-2 text-right">{t('col_completed')}</th>
                        <th className="px-3 py-2 text-right">{t('completion_rate')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.utm.map(row => (
                        <tr key={row.utmContent ?? '__none__'} className="border-t">
                          <td className="px-3 py-2 font-mono text-xs">{row.utmContent ?? t('no_utm')}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.sessions}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.completed}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {row.sessions > 0 ? pct(row.completed / row.sessions) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* 自我回報 */}
              <section className="mb-8">
                <h2 className="mb-3 text-lg font-semibold">{t('self_report')}</h2>
                <div className="grid gap-4 sm:grid-cols-3">
                  <BreakdownList title={t('role')} rows={stats.profile.role} label={roleLabel} emptyText={t('no_data')} />
                  <BreakdownList title={t('language')} rows={stats.profile.language} label={languageLabel} emptyText={t('no_data')} />
                  <BreakdownList title={t('exam_plan')} rows={stats.profile.examPlan} label={examPlanLabel} emptyText={t('no_data')} />
                </div>
              </section>
            </>
          )}
    </div>
  );
}

function StatCard({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {children}
    </div>
  );
}

function BreakdownList({
  title,
  rows,
  label,
  emptyText,
}: {
  title: string;
  rows: { value: string | null; count: number }[];
  label: (v: string | null) => string;
  emptyText: string;
}) {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return (
    <div className="rounded-xl border p-4">
      <p className="mb-2 text-sm font-semibold">{title}</p>
      {rows.length === 0
        ? <p className="text-xs text-muted-foreground">{emptyText}</p>
        : (
            <ul className="space-y-1.5 text-sm">
              {rows.map(r => (
                <li key={r.value ?? '__null__'} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 truncate">{label(r.value)}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${total > 0 ? (r.count / total) * 100 : 0}%` }} />
                  </div>
                  <span className="w-8 text-right tabular-nums text-muted-foreground">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
    </div>
  );
}
