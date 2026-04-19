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
  const latestWithResults = data.recentQuizzes.find(q => q.responseCount > 0);

  return (
    <div className="pb-8">
      {/* Hero Banner */}
      <div className="mx-4 mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-500 px-6 py-8 text-white shadow-lg sm:px-10 sm:py-10">
        <p className="text-sm font-medium text-white/80">{greeting}</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">歡迎使用 QuizFlow</h1>
        <p className="mt-2 max-w-lg text-sm text-white/80">
          {data.publishedCount > 0
            ? `您有 ${data.publishedCount} 份測驗進行中，共 ${data.totalResponses} 位學生已作答。`
            : '開始建立您的第一份測驗，幾分鐘內即可分享給學生。'}
        </p>
      </div>

      {/* ── 快速行動卡片 ── */}
      <div className="mx-4 mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* 建立新測驗 */}
        <Link
          href="/dashboard/quizzes/new"
          className="group flex items-start gap-4 rounded-xl border-2 border-transparent bg-card p-5 shadow-sm transition-all hover:border-blue-200 hover:shadow-md hover:-translate-y-0.5"
        >
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
            <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-bold text-foreground">建立新測驗</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">手動出題，自由掌控題目內容與配分</p>
          </div>
          <svg className="mt-1 size-4 shrink-0 text-muted-foreground/30 transition-all group-hover:translate-x-0.5 group-hover:text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>

        {/* AI 智慧出題 */}
        <Link
          href="/dashboard/quizzes/new"
          className="group flex items-start gap-4 rounded-xl border-2 border-transparent bg-card p-5 shadow-sm transition-all hover:border-violet-200 hover:shadow-md hover:-translate-y-0.5"
        >
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600 transition-colors group-hover:bg-violet-600 group-hover:text-white">
            <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-bold text-foreground">AI 智慧出題</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">上傳講義或輸入主題，AI 自動生成試題</p>
          </div>
          <svg className="mt-1 size-4 shrink-0 text-muted-foreground/30 transition-all group-hover:translate-x-0.5 group-hover:text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>

        {/* 查看最新成績 */}
        <Link
          href={latestWithResults
            ? `/dashboard/quizzes/${latestWithResults.id}/results`
            : '/dashboard/quizzes'}
          className="group flex items-start gap-4 rounded-xl border-2 border-transparent bg-card p-5 shadow-sm transition-all hover:border-emerald-200 hover:shadow-md hover:-translate-y-0.5"
        >
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 transition-colors group-hover:bg-emerald-600 group-hover:text-white">
            <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-bold text-foreground">查看最新成績</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {latestWithResults
                ? `${latestWithResults.title}（${latestWithResults.responseCount} 人作答）`
                : '查看學生作答結果與分析'}
            </p>
          </div>
          <svg className="mt-1 size-4 shrink-0 text-muted-foreground/30 transition-all group-hover:translate-x-0.5 group-hover:text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>

        {/* AI 單字卡 */}
        <Link
          href="/dashboard/vocab/new"
          className="group flex items-start gap-4 rounded-xl border-2 border-transparent bg-card p-5 shadow-sm transition-all hover:border-amber-200 hover:shadow-md hover:-translate-y-0.5"
        >
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 transition-colors group-hover:bg-amber-600 group-hover:text-white">
            <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-bold text-foreground">AI 單字卡</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">輸入單字，AI 生成卡片與發音練習</p>
          </div>
          <svg className="mt-1 size-4 shrink-0 text-muted-foreground/30 transition-all group-hover:translate-x-0.5 group-hover:text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
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

                    {/* Title + Description */}
                    <h3 className="truncate text-base font-semibold group-hover:text-primary">
                      {quiz.title}
                    </h3>
                    {quiz.description && (
                      <p className="mt-1 mb-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                        {quiz.description}
                      </p>
                    )}
                    {!quiz.description && <div className="mb-3" />}

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
