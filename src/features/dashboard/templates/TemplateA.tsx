import Link from 'next/link';

import type { DashboardData } from './types';
import { STATUS_LABEL } from './types';

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  published: 'bg-emerald-50 text-emerald-700',
  closed: 'bg-red-50 text-red-600',
};

const STAT_CARDS = [
  {
    key: 'total',
    label: '測驗總數',
    accent: 'border-l-blue-500',
    iconPath: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    iconColor: 'text-blue-500',
  },
  {
    key: 'published',
    label: '已發佈',
    accent: 'border-l-emerald-500',
    iconPath: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    iconColor: 'text-emerald-500',
  },
  {
    key: 'responses',
    label: '學生作答',
    accent: 'border-l-violet-500',
    iconPath: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
    iconColor: 'text-violet-500',
  },
  {
    key: 'score',
    label: '平均答對率',
    accent: 'border-l-amber-500',
    iconPath: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
    iconColor: 'text-amber-500',
  },
] as const;

function getStatValue(key: string, data: DashboardData): string {
  switch (key) {
    case 'total':
      return String(data.totalQuizCount);
    case 'published':
      return String(data.publishedCount);
    case 'responses':
      return String(data.totalResponses);
    case 'score':
      return data.avgScorePercent !== null ? `${data.avgScorePercent}%` : '—';
    default:
      return '—';
  }
}

export function TemplateA({ data }: { data: DashboardData }) {
  return (
    <div className="px-4 pb-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">後台首頁</h1>
          <p className="mt-1 text-sm text-muted-foreground">以下是您的測驗概覽</p>
        </div>
        <Link
          href="/dashboard/quizzes/new"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          建立新測驗
        </Link>
      </div>

      {/* 4 Stat Cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STAT_CARDS.map(card => (
          <div
            key={card.key}
            className={`rounded-lg border border-l-4 ${card.accent} bg-card px-5 py-4 shadow-sm`}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">{card.label}</p>
              <svg
                className={`size-5 ${card.iconColor} opacity-70`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d={card.iconPath} />
              </svg>
            </div>
            <p className="mt-2 text-3xl font-bold tracking-tight">{getStatValue(card.key, data)}</p>
          </div>
        ))}
      </div>

      {/* Recent Quizzes Table */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">最近的測驗</h2>
        <div className="overflow-hidden rounded-xl border shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted/60">
              <tr>
                <th className="px-5 py-3 text-left font-medium text-muted-foreground">標題</th>
                <th className="hidden px-5 py-3 text-left font-medium text-muted-foreground sm:table-cell">狀態</th>
                <th className="hidden px-5 py-3 text-center font-medium text-muted-foreground md:table-cell">作答人數</th>
                <th className="px-5 py-3 text-right font-medium text-muted-foreground">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.recentQuizzes.map(quiz => (
                <tr key={quiz.id} className="transition-colors hover:bg-muted/20">
                  <td className="px-5 py-3.5">
                    <span className="font-medium">{quiz.title}</span>
                    <span className="ml-2 inline sm:hidden">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[quiz.status] ?? ''}`}>
                        {STATUS_LABEL[quiz.status] ?? quiz.status}
                      </span>
                    </span>
                  </td>
                  <td className="hidden px-5 py-3.5 sm:table-cell">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[quiz.status] ?? ''}`}>
                      {STATUS_LABEL[quiz.status] ?? quiz.status}
                    </span>
                  </td>
                  <td className="hidden px-5 py-3.5 text-center text-muted-foreground md:table-cell">
                    {quiz.responseCount > 0 ? `${quiz.responseCount} 人` : '—'}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <Link href={`/dashboard/quizzes/${quiz.id}/edit`} className="mr-3 text-primary hover:underline">
                      編輯
                    </Link>
                    <Link href={`/dashboard/quizzes/${quiz.id}/results`} className="text-muted-foreground hover:underline">
                      成績
                    </Link>
                  </td>
                </tr>
              ))}
              {data.recentQuizzes.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                    尚無測驗，立即建立第一份吧！
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {data.totalQuizCount > 5 && (
          <div className="mt-3 text-right">
            <Link href="/dashboard/quizzes" className="text-sm text-primary hover:underline">
              查看全部測驗 →
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
