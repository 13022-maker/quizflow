import Link from 'next/link';

import { QuizCardActions } from './QuizCardActions';
import type { DashboardData } from './types';
import { relativeDate, STATUS_LABEL } from './types';

// 狀態對應的 banner 漸層（已發佈：活力綠青；草稿：沉穩藍紫；已關閉：粉橘警示）
const STATUS_GRADIENT: Record<string, string> = {
  draft: 'from-slate-400 via-slate-500 to-slate-600',
  published: 'from-emerald-400 via-teal-500 to-cyan-600',
  closed: 'from-rose-400 via-pink-500 to-rose-600',
};

// 單字模式用專屬暖色（琥珀系），讓一眼能辨識
const VOCAB_GRADIENT = 'from-amber-400 via-orange-500 to-rose-500';

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
                {data.recentQuizzes.map((quiz) => {
                  const gradient = quiz.quizMode === 'vocab'
                    ? VOCAB_GRADIENT
                    : (STATUS_GRADIENT[quiz.status] ?? STATUS_GRADIENT.draft);
                  const isPublished = quiz.status === 'published';

                  return (
                    <div
                      key={quiz.id}
                      className="group relative flex flex-col overflow-hidden rounded-2xl border border-black/5 bg-card shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl"
                    >
                      {/* 漸層 banner */}
                      <div className={`relative h-20 bg-gradient-to-br ${gradient}`}>
                        {/* 裝飾圖形：左下角大圓 + 右上角小圓，純視覺點綴 */}
                        <span className="pointer-events-none absolute -bottom-6 -left-4 size-20 rounded-full bg-white/15" />
                        <span className="pointer-events-none absolute -right-3 -top-3 size-12 rounded-full bg-white/10" />

                        {/* 狀態膠囊（左上） */}
                        <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-white/25 px-2.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
                          <span className="size-1.5 rounded-full bg-white shadow-sm" />
                          {quiz.quizMode === 'vocab' ? '🔤 單字' : (STATUS_LABEL[quiz.status] ?? quiz.status)}
                        </div>

                        {/* 日期（右上） */}
                        <span className="absolute right-3 top-3 text-[11px] font-medium text-white/90">
                          {relativeDate(quiz.createdAt)}
                        </span>

                        {/* Hover 出現：開啟預覽連結 */}
                        {isPublished && (
                          <Link
                            href={`/quiz/${quiz.accessCode}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="absolute bottom-2 right-3 flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-medium text-gray-700 opacity-100 shadow-sm transition-opacity hover:bg-white md:opacity-0 md:group-hover:opacity-100"
                            title="在新分頁開啟學生作答頁"
                          >
                            <svg className="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                            </svg>
                            開啟
                          </Link>
                        )}
                      </div>

                      {/* 資訊區 */}
                      <div className="relative flex flex-1 flex-col p-4">
                        {/* Hover 浮現的快捷：分享 + 複製連結（已發佈才顯示） */}
                        {isPublished && (
                          <QuizCardActions accessCode={quiz.accessCode} title={quiz.title} />
                        )}

                        <h3 className="mb-2 line-clamp-2 pr-16 text-[15px] font-bold leading-snug text-foreground transition-colors group-hover:text-primary">
                          {quiz.title}
                        </h3>

                        <div className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
                          </svg>
                          <span className="font-medium">{quiz.responseCount}</span>
                          <span>人作答</span>
                        </div>

                        {/* 動作按鈕：推到底 */}
                        <div className="mt-auto flex gap-2">
                          <Link
                            href={`/dashboard/quizzes/${quiz.id}/edit`}
                            className="flex-1 rounded-lg border bg-white px-3 py-1.5 text-center text-xs font-semibold text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50"
                          >
                            編輯
                          </Link>
                          <Link
                            href={`/dashboard/quizzes/${quiz.id}/results`}
                            className="flex-1 rounded-lg bg-primary px-3 py-1.5 text-center text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                          >
                            成績
                          </Link>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* 新增測驗卡：保持 dashed 風格但高度對齊 */}
                <Link
                  href="/dashboard/quizzes/new"
                  className="group flex min-h-[188px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-muted-foreground/20 bg-muted/30 p-5 text-muted-foreground transition-all hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
                >
                  <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-white shadow-sm transition-transform group-hover:scale-110">
                    <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <span className="text-sm font-semibold">建立新測驗</span>
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
  if (hour < 12) {
    return '早安！';
  }
  if (hour < 18) {
    return '午安！';
  }
  return '晚安！';
}
