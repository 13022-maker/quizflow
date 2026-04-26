'use client';

import type { InferSelectModel } from 'drizzle-orm';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { deleteQuiz } from '@/actions/quizActions';
import ShareModal from '@/components/quiz/ShareModal';
import type { quizSchema } from '@/models/Schema';

type Quiz = InferSelectModel<typeof quizSchema>;

const STATUS_CONFIG: Record<Quiz['status'], { label: string; dot: string; bg: string }> = {
  draft: { label: '草稿', dot: 'bg-gray-400', bg: 'bg-gray-50' },
  published: { label: '已發佈', dot: 'bg-emerald-500', bg: 'bg-emerald-50' },
  closed: { label: '已關閉', dot: 'bg-red-400', bg: 'bg-red-50' },
};

export function QuizCardList({
  quizzes,
  responseCounts,
}: {
  quizzes: Quiz[];
  responseCounts: Map<number, number>;
}) {
  const sorted = [...quizzes].reverse();

  return (
    <div className="space-y-3">
      {sorted.map(quiz => (
        <QuizCard
          key={quiz.id}
          quiz={quiz}
          responseCount={responseCounts.get(quiz.id) ?? 0}
        />
      ))}
    </div>
  );
}

function QuizCard({ quiz, responseCount }: { quiz: Quiz; responseCount: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showShare, setShowShare] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const status = STATUS_CONFIG[quiz.status];
  const dateStr = quiz.createdAt.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });

  const handleDelete = () => {
    startTransition(async () => {
      await deleteQuiz(quiz.id);
      setShowDelete(false);
      router.refresh();
    });
  };

  return (
    <>
      <div className="group rounded-xl border bg-card p-4 transition-all hover:shadow-md sm:p-5">
        {/* 上半：標題 + 狀態 */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <Link
            href={`/dashboard/quizzes/${quiz.id}/edit`}
            className="min-w-0 flex-1 border-l-[3px] border-primary/70 pl-3"
          >
            <h3 className="text-lg font-bold leading-snug tracking-tight text-foreground group-hover:text-primary sm:text-xl">
              {quiz.title}
            </h3>
            {quiz.description && (
              <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{quiz.description}</p>
            )}
          </Link>
          <span className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${status.bg}`}>
            <span className={`size-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </span>
        </div>

        {/* 中間：數據 */}
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
            {dateStr}
          </span>
          <span className="flex items-center gap-1">
            <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
            </svg>
            {responseCount}
            {' '}
            人作答
          </span>
          {quiz.roomCode && (
            <span className="flex items-center gap-1 font-mono text-xs">
              房間碼
              {' '}
              {quiz.roomCode}
            </span>
          )}
        </div>

        {/* 下半：操作按鈕 */}
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/dashboard/quizzes/${quiz.id}/edit`}
            className="rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-muted"
          >
            編輯
          </Link>
          {responseCount > 0 && (
            <Link
              href={`/dashboard/quizzes/${quiz.id}/results`}
              className="rounded-lg bg-primary/10 px-3.5 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20"
            >
              成績
            </Link>
          )}
          {quiz.accessCode && (
            <button
              type="button"
              onClick={() => setShowShare(true)}
              className="rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-muted"
            >
              分享
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowDelete(true)}
            disabled={isPending}
            className="ml-auto rounded-lg px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600"
          >
            {isPending ? '刪除中…' : '刪除'}
          </button>
        </div>

        {/* 刪除確認 */}
        {showDelete && (
          <div className="mt-3 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="flex-1 text-sm text-red-700">
              確定要刪除「
              {quiz.title}
              」？此操作無法復原。
            </p>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isPending}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              確定刪除
            </button>
            <button
              type="button"
              onClick={() => setShowDelete(false)}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-white"
            >
              取消
            </button>
          </div>
        )}
      </div>

      {/* 分享 Modal */}
      {showShare && quiz.accessCode && (
        <ShareModal
          quizId={quiz.id}
          quizTitle={quiz.title}
          accessCode={quiz.accessCode}
          roomCode={quiz.roomCode}
          expiresAt={quiz.expiresAt instanceof Date ? quiz.expiresAt.toISOString() : (quiz.expiresAt ?? null)}
          currentVisibility={quiz.visibility}
          currentSlug={quiz.slug}
          onClose={() => setShowShare(false)}
        />
      )}
    </>
  );
}
