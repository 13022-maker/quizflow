'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { copyQuizFromMarketplace } from '@/actions/marketplaceActions';

type Props = {
  quiz: {
    id: number;
    title: string;
    description: string | null;
    category: string | null;
    gradeLevel: string | null;
    tags: string[] | null;
    forkCount: number;
    createdAt: string;
  };
  questionCount: number;
};

export function MarketplaceCard({ quiz, questionCount }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    startTransition(async () => {
      const res = await copyQuizFromMarketplace(quiz.id);
      if (res?.error) {
        // eslint-disable-next-line no-alert
        window.alert(res.error);
        return;
      }
      if (res?.newQuizId) {
        setCopied(true);
        setTimeout(() => {
          router.push(`/dashboard/quizzes/${res.newQuizId}/edit`);
        }, 500);
      }
    });
  };

  return (
    <div className="group flex flex-col rounded-xl border bg-card p-5 shadow-sm transition-all hover:shadow-md">
      {/* 標籤 */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {quiz.category && (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
            {quiz.category}
          </span>
        )}
        {quiz.gradeLevel && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
            {quiz.gradeLevel}
          </span>
        )}
      </div>

      {/* 標題 + 說明 */}
      <h3 className="mb-1 text-base font-semibold leading-snug text-foreground">
        {quiz.title}
      </h3>
      {quiz.description && (
        <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">{quiz.description}</p>
      )}

      {/* 標籤 */}
      {quiz.tags && quiz.tags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {quiz.tags.map(tag => (
            <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              #
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto" />

      {/* 數據 */}
      <div className="mb-3 flex items-center gap-3 text-xs text-muted-foreground">
        <span>
          {questionCount}
          {' '}
          題
        </span>
        <span>·</span>
        <span>
          {quiz.forkCount}
          {' '}
          人使用
        </span>
      </div>

      {/* 複製按鈕 */}
      <button
        type="button"
        onClick={handleCopy}
        disabled={isPending || copied}
        className={`w-full rounded-lg py-2.5 text-sm font-semibold transition-all ${
          copied
            ? 'bg-green-100 text-green-700'
            : 'bg-primary text-primary-foreground hover:bg-primary/90'
        } disabled:opacity-50`}
      >
        {copied ? '✅ 已複製！跳轉中…' : isPending ? '複製中…' : '複製到我的測驗'}
      </button>
    </div>
  );
}
