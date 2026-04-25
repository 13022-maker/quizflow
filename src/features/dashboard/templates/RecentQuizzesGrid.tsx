'use client';

/**
 * RecentQuizzesGrid — 儀表板「最近的測驗」可篩選卡片區塊
 * 支援依狀態（全部 / 已發佈 / 草稿）篩選，顯示至多 6 張卡片
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { CreateQuizWithAIButton } from '@/features/quiz/CreateQuizWithAIButton';

import { QuizCardActions } from './QuizCardActions';
import type { EnrichedQuiz } from './types';
import { relativeDate, STATUS_LABEL } from './types';

// 狀態對應的 banner 漸層（已發佈:綠青、草稿:灰、關閉:玫紅）
const STATUS_GRADIENT: Record<string, string> = {
  draft: 'from-slate-400 via-slate-500 to-slate-600',
  published: 'from-emerald-400 via-teal-500 to-cyan-600',
  closed: 'from-rose-400 via-pink-500 to-rose-600',
};

// 單字模式用專屬暖色（琥珀系）
const VOCAB_GRADIENT = 'from-amber-400 via-orange-500 to-rose-500';

const MAX_DISPLAY = 6;

type Filter = 'all' | 'published' | 'draft';

export function RecentQuizzesGrid({
  quizzes,
  totalQuizCount,
}: {
  quizzes: EnrichedQuiz[];
  totalQuizCount: number;
}) {
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = useMemo(() => {
    if (filter === 'all') {
      return quizzes.slice(0, MAX_DISPLAY);
    }
    return quizzes.filter(q => q.status === filter).slice(0, MAX_DISPLAY);
  }, [filter, quizzes]);

  const counts = useMemo(() => ({
    all: quizzes.length,
    published: quizzes.filter(q => q.status === 'published').length,
    draft: quizzes.filter(q => q.status === 'draft').length,
  }), [quizzes]);

  return (
    <div className="px-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">最近的測驗</h2>
          <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-0.5 text-xs">
            <FilterTab active={filter === 'all'} onClick={() => setFilter('all')} label="全部" count={counts.all} />
            <FilterTab active={filter === 'published'} onClick={() => setFilter('published')} label="已發佈" count={counts.published} />
            <FilterTab active={filter === 'draft'} onClick={() => setFilter('draft')} label="草稿" count={counts.draft} />
          </div>
        </div>
        {totalQuizCount > MAX_DISPLAY && (
          <Link href="/dashboard/quizzes" className="text-sm text-primary hover:underline">
            查看全部 →
          </Link>
        )}
      </div>

      {quizzes.length === 0
        ? <EmptyState />
        : filtered.length === 0
          ? (
              <div className="rounded-xl border-2 border-dashed py-12 text-center text-sm text-muted-foreground">
                此分類下目前沒有測驗
              </div>
            )
          : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((quiz) => {
                  const gradient = quiz.quizMode === 'vocab'
                    ? VOCAB_GRADIENT
                    : (STATUS_GRADIENT[quiz.status] ?? STATUS_GRADIENT.draft);
                  const isPublished = quiz.status === 'published';

                  return (
                    <div
                      key={quiz.id}
                      className="group relative flex flex-col overflow-hidden rounded-2xl border border-black/5 bg-card shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl"
                    >
                      <div className={`relative h-20 bg-gradient-to-br ${gradient}`}>
                        <span className="pointer-events-none absolute -bottom-6 -left-4 size-20 rounded-full bg-white/15" />
                        <span className="pointer-events-none absolute -right-3 -top-3 size-12 rounded-full bg-white/10" />

                        <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-white/25 px-2.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
                          <span className="size-1.5 rounded-full bg-white shadow-sm" />
                          {quiz.quizMode === 'vocab' ? '🔤 單字' : (STATUS_LABEL[quiz.status] ?? quiz.status)}
                        </div>

                        <span className="absolute right-3 top-3 text-[11px] font-medium text-white/90">
                          {relativeDate(quiz.createdAt)}
                        </span>

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

                      <div className="relative flex flex-1 flex-col p-4">
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

                {/* 虛線卡片：點下直達 AI 命題（沿用 dashed 樣式做為「快速新增」視覺提示） */}
                <CreateQuizWithAIButton
                  className="group flex min-h-[188px] w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-muted-foreground/20 bg-muted/30 p-5 text-muted-foreground transition-all hover:border-primary/50 hover:bg-primary/5 hover:text-primary disabled:opacity-70"
                  pendingLabel="建立中…"
                >
                  <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-white shadow-sm transition-transform group-hover:scale-110">
                    <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <span className="text-sm font-semibold">建立新測驗</span>
                </CreateQuizWithAIButton>
              </div>
            )}
    </div>
  );
}

function FilterTab({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-colors ${
        active
          ? 'bg-white text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
      <span className={`rounded-full px-1.5 text-[10px] ${active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
        {count}
      </span>
    </button>
  );
}

function EmptyState() {
  return (
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
  );
}
