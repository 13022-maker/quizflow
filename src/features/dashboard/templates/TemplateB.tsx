import Link from 'next/link';

import type { DashboardData } from './types';
import { relativeDate, STATUS_LABEL } from './types';

const STATUS_DOT: Record<string, string> = {
  draft: 'bg-gray-400',
  published: 'bg-emerald-500',
  closed: 'bg-red-400',
};

export function TemplateB({ data }: { data: DashboardData }) {
  const greeting = getGreeting();

  return (
    <div className="pb-8">
      {/* Hero Banner */}
      <div className="mx-4 mb-8 overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-blue-600 to-cyan-500 px-6 py-8 text-white shadow-lg sm:px-10 sm:py-10">
        <p className="text-sm font-medium text-white/80">{greeting}</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">歡迎使用 QuizFlow</h1>
        <p className="mt-2 max-w-lg text-sm text-white/80">
          {data.publishedCount > 0
            ? `您有 ${data.publishedCount} 份測驗進行中，共 ${data.totalResponses} 位學生已作答。`
            : '開始建立您的第一份測驗，幾分鐘內即可分享給學生。'}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/dashboard/quizzes/new"
            className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-indigo-700 shadow-sm transition-transform hover:scale-[1.02]"
          >
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            建立新測驗
          </Link>
          {data.totalResponses > 0 && (
            <Link
              href="/dashboard/quizzes"
              className="inline-flex items-center gap-2 rounded-lg bg-white/15 px-5 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/25"
            >
              查看成績報表
            </Link>
          )}
        </div>
      </div>

      {/* Horizontal Stats Strip */}
      <div className="mx-4 mb-8 grid grid-cols-3 divide-x overflow-hidden rounded-xl border bg-card shadow-sm">
        <StatBlock value={String(data.totalQuizCount)} label="測驗總數" />
        <StatBlock value={String(data.totalResponses)} label="學生作答" />
        <StatBlock value={data.avgScorePercent !== null ? `${data.avgScorePercent}%` : '—'} label="平均答對率" />
      </div>

      {/* Quiz Card Grid */}
      <div className="px-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">最近的測驗</h2>
          {data.totalQuizCount > 6 && (
            <Link href="/dashboard/quizzes" className="text-sm text-primary hover:underline">
              查看全部 →
            </Link>
          )}
        </div>

        {data.recentQuizzes.length > 0
          ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.recentQuizzes.map(quiz => (
                  <div
                    key={quiz.id}
                    className="group rounded-xl border bg-card p-5 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
                  >
                    {/* Status + Date */}
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`size-2 rounded-full ${STATUS_DOT[quiz.status] ?? 'bg-gray-400'}`} />
                        <span className="text-xs font-medium text-muted-foreground">
                          {STATUS_LABEL[quiz.status] ?? quiz.status}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {relativeDate(quiz.createdAt)}
                      </span>
                    </div>

                    {/* Title */}
                    <h3 className="mb-3 truncate text-base font-semibold group-hover:text-primary">
                      {quiz.title}
                    </h3>

                    {/* Metrics */}
                    <div className="mb-4 flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
                        </svg>
                        {quiz.responseCount} 人
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Link
                        href={`/dashboard/quizzes/${quiz.id}/edit`}
                        className="flex-1 rounded-lg border px-3 py-2 text-center text-sm font-medium transition-colors hover:bg-muted"
                      >
                        編輯
                      </Link>
                      <Link
                        href={`/dashboard/quizzes/${quiz.id}/results`}
                        className="flex-1 rounded-lg bg-primary/10 px-3 py-2 text-center text-sm font-medium text-primary transition-colors hover:bg-primary/20"
                      >
                        成績
                      </Link>
                    </div>
                  </div>
                ))}

                {/* New Quiz Card */}
                <Link
                  href="/dashboard/quizzes/new"
                  className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/20 p-5 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  <svg className="mb-2 size-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  <span className="text-sm font-medium">建立新測驗</span>
                </Link>
              </div>
            )
          : (
              <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-16 text-muted-foreground">
                <svg className="mb-3 size-12 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <p className="mb-1 font-medium">尚無測驗</p>
                <p className="mb-4 text-sm">建立您的第一份測驗吧</p>
                <Link
                  href="/dashboard/quizzes/new"
                  className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  立即建立
                </Link>
              </div>
            )}
      </div>
    </div>
  );
}

function StatBlock({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-4 py-5 text-center sm:px-6">
      <p className="text-2xl font-bold tracking-tight sm:text-3xl">{value}</p>
      <p className="mt-1 text-xs font-medium text-muted-foreground sm:text-sm">{label}</p>
    </div>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return '早安！';
  if (hour < 18) return '午安！';
  return '晚安！';
}
