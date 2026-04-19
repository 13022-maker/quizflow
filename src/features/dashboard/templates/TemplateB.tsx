import Link from 'next/link';

import { RecentQuizzesGrid } from './RecentQuizzesGrid';
import type { DashboardData } from './types';

export function TemplateB({ data }: { data: DashboardData }) {
  const greeting = getGreeting();
  const latestWithResults = data.recentQuizzes.find(q => q.responseCount > 0);

  return (
    <div className="pb-8">
      {/* Hero Banner */}
      <div className="mx-4 mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-blue-600 to-cyan-500 px-6 py-8 text-white shadow-lg sm:p-10">
        <p className="text-sm font-medium text-white/80">{greeting}</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">歡迎使用 QuizFlow</h1>
        <p className="mt-2 max-w-lg text-sm text-white/80">
          {data.publishedCount > 0
            ? `您有 ${data.publishedCount} 份測驗進行中，共 ${data.totalResponses} 位學生已作答。`
            : '開始建立您的第一份測驗，幾分鐘內即可分享給學生。'}
        </p>
      </div>

      {/* ── 快速行動卡片 ── */}
      <div className="mx-4 mb-8 grid gap-3 sm:grid-cols-3">
        {/* 建立新測驗 */}
        <Link
          href="/dashboard/quizzes/new"
          className="group flex items-start gap-4 rounded-xl border-2 border-transparent bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
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
          className="group flex items-start gap-4 rounded-xl border-2 border-transparent bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md"
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
          className="group flex items-start gap-4 rounded-xl border-2 border-transparent bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md"
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
      </div>

      {/* Horizontal Stats Strip */}
      <div className="mx-4 mb-8 grid grid-cols-3 divide-x overflow-hidden rounded-xl border bg-card shadow-sm">
        <StatBlock value={String(data.totalQuizCount)} label="測驗總數" />
        <StatBlock value={String(data.totalResponses)} label="學生作答" />
        <StatBlock value={data.avgScorePercent !== null ? `${data.avgScorePercent}%` : '—'} label="平均答對率" />
      </div>

      {/* Quiz Card Grid */}
      <RecentQuizzesGrid quizzes={data.recentQuizzes} totalQuizCount={data.totalQuizCount} />
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
  if (hour < 12) {
    return '早安！';
  }
  if (hour < 18) {
    return '午安！';
  }
  return '晚安！';
}
