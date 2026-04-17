import Link from 'next/link';

import type { DashboardData } from './types';
import { relativeDate, STATUS_LABEL } from './types';

const STATUS_BORDER: Record<string, string> = {
  draft: 'border-l-gray-300',
  published: 'border-l-emerald-400',
  closed: 'border-l-red-300',
};

const STATUS_TAG: Record<string, string> = {
  draft: 'text-gray-500',
  published: 'text-emerald-600',
  closed: 'text-red-500',
};

export function TemplateC({ data }: { data: DashboardData }) {
  return (
    <div className="px-4 pb-8">
      {/* Minimal Header */}
      <div className="mb-10">
        <h1 className="text-2xl font-light tracking-tight text-foreground/80">
          後台首頁
        </h1>
      </div>

      {/* Large Stat Numbers */}
      <div className="mb-12 flex items-start justify-start gap-0">
        <StatNum value={String(data.totalQuizCount)} label="測驗總數" />
        <div className="mx-6 h-14 w-px self-center bg-border sm:mx-10" />
        <StatNum value={String(data.totalResponses)} label="學生作答" />
        <div className="mx-6 h-14 w-px self-center bg-border sm:mx-10" />
        <StatNum
          value={data.avgScorePercent !== null ? `${data.avgScorePercent}%` : '—'}
          label="平均答對率"
        />
      </div>

      {/* Recent Quizzes - Timeline List */}
      <section>
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            最近測驗
          </h2>
          <Link
            href="/dashboard/quizzes/new"
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            新測驗
          </Link>
        </div>

        <div className="space-y-2">
          {data.recentQuizzes.map(quiz => (
            <Link
              key={quiz.id}
              href={`/dashboard/quizzes/${quiz.id}/edit`}
              className={`group block rounded-lg border-l-[3px] ${STATUS_BORDER[quiz.status] ?? 'border-l-gray-300'} bg-card py-4 pl-5 pr-4 transition-all hover:bg-muted/40 hover:shadow-sm`}
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-[15px] font-medium transition-colors group-hover:text-primary">
                    {quiz.title}
                  </h3>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className={`font-medium ${STATUS_TAG[quiz.status] ?? ''}`}>
                      {STATUS_LABEL[quiz.status] ?? quiz.status}
                    </span>
                    {quiz.responseCount > 0 && (
                      <>
                        <span className="text-border">·</span>
                        <span>{quiz.responseCount} 人作答</span>
                      </>
                    )}
                    <span className="text-border">·</span>
                    <span>{relativeDate(quiz.createdAt)}</span>
                  </div>
                </div>

                {/* Arrow */}
                <svg
                  className="ml-3 size-4 shrink-0 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-primary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>

        {data.recentQuizzes.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-sm text-muted-foreground">尚無測驗</p>
            <Link
              href="/dashboard/quizzes/new"
              className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
            >
              建立第一份測驗 →
            </Link>
          </div>
        )}

        {data.totalQuizCount > 5 && (
          <div className="mt-6 text-center">
            <Link
              href="/dashboard/quizzes"
              className="text-sm text-muted-foreground transition-colors hover:text-primary"
            >
              查看全部 {data.totalQuizCount} 份測驗 →
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}

function StatNum({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-4xl font-extralight tracking-tight sm:text-5xl">{value}</p>
      <p className="mt-1 text-xs font-medium text-muted-foreground">{label}</p>
    </div>
  );
}
