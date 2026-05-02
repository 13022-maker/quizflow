import Link from 'next/link';

import { QuickCreateAIButton } from './QuickCreateAIButton';
import { RecentQuizzesGrid } from './RecentQuizzesGrid';
import type { DashboardData } from './types';

export function TemplateB({ data }: { data: DashboardData }) {
  const greeting = getGreeting();
  const latestWithResults = data.recentQuizzes.find(q => q.responseCount > 0);

  return (
    <div className="pb-8">
      {/* Hero Banner */}
      <div className="mx-4 mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-500 px-6 py-10 text-white shadow-lg sm:px-10 sm:py-14">
        {/* 小字時段問候（uppercase + tracking 做 premium 感） */}
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">{greeting}</p>
        {/* 大字 Hero 標題：放大、加黑、收緊字距 */}
        <h1 className="mt-3 text-3xl font-black leading-tight tracking-tight sm:text-5xl">
          歡迎使用 QuizFlow
        </h1>
        {/* 統計副標：數字獨立粗黑、整行字級放大 */}
        {data.publishedCount > 0
          ? (
              <p className="mt-5 max-w-xl text-base text-white/85 sm:text-lg">
                您有
                {' '}
                <span className="text-2xl font-black text-white sm:text-3xl">{data.publishedCount}</span>
                {' '}
                份測驗進行中，共
                {' '}
                <span className="text-2xl font-black text-white sm:text-3xl">{data.totalResponses}</span>
                {' '}
                位學生已作答。
              </p>
            )
          : (
              <p className="mt-5 max-w-xl text-base text-white/85 sm:text-lg">
                開始建立您的第一份測驗，幾分鐘內即可分享給學生。
              </p>
            )}
        {/* 品牌 tagline：三段式標語，取代原本的 pill */}
        <p className="mt-8 text-sm font-medium tracking-wide text-white/60">
          少紙化
          <span className="mx-2 text-white/30">·</span>
          效率佳
          <span className="mx-2 text-white/30">·</span>
          讓老師專注教學
        </p>
      </div>

      {/* ── 快速行動卡片 ── */}
      <div className="mx-4 mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* AI 智慧出題：一鍵直達編輯頁 + AI Modal（省略 /new 中間頁） */}
        <QuickCreateAIButton />

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

        {/* AI 單字卡 */}
        <Link
          href="/dashboard/vocab/new"
          className="group flex items-start gap-4 rounded-xl border-2 border-transparent bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-amber-200 hover:shadow-md"
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

        {/* 進階建立：副選單入口（手動出題、單字記憶等需要先進 /new 頁的流程） */}
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
            <h3 className="text-[15px] font-bold text-foreground">進階建立</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">手動出題、單字記憶模式</p>
          </div>
          <svg className="mt-1 size-4 shrink-0 text-muted-foreground/30 transition-all group-hover:translate-x-0.5 group-hover:text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
  const utcNow = new Date();
  const hour = (utcNow.getUTCHours() + 8) % 24;
  if (hour < 12) {
    return '早安！';
  }
  if (hour < 18) {
    return '午安！';
  }
  return '晚安！';
}
