'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { InferSelectModel } from 'drizzle-orm';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { createLiveGame } from '@/actions/liveActions';
import { deleteQuiz } from '@/actions/quizActions';
import ShareModal from '@/components/quiz/ShareModal';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { quizSchema } from '@/models/Schema';

type Quiz = InferSelectModel<typeof quizSchema>;

const STATUS_STYLES: Record<Quiz['status'], string> = {
  draft: 'bg-gray-100 text-gray-700',
  published: 'bg-green-100 text-green-700',
  closed: 'bg-red-100 text-red-600',
};

function StatusBadge({ status }: { status: Quiz['status'] }) {
  const t = useTranslations('QuizTableColumns');
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {t(`status_${status}`)}
    </span>
  );
}

function ActionsCell({ quiz }: { quiz: Quiz }) {
  const t = useTranslations('QuizTableColumns');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  const handleStartLive = () => {
    setLiveError(null);
    startTransition(async () => {
      const res = await createLiveGame({ quizId: quiz.id });
      // DEBUG：把完整 res 印到 console 方便定位暫時的 'error' in undefined
      // eslint-disable-next-line no-console
      console.warn('[createLiveGame result]', res);
      if (res && typeof res === 'object' && 'error' in res) {
        setLiveError(res.error ?? '建立失敗');
        return;
      }
      if (!res || !('gameId' in res)) {
        setLiveError('建立失敗：server 回傳異常');
        return;
      }
      router.push(`/dashboard/live/host/${res.gameId}`);
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      await deleteQuiz(quiz.id);
    });
  };

  // 複製學生作答連結（使用 accessCode，避免學生猜測 ID）
  const handleCopyLink = () => {
    const path = quiz.accessCode ? `/quiz/${quiz.accessCode}` : `/quiz/${quiz.id}`;
    const url = `${window.location.origin}${path}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={isPending}>
            ···
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/dashboard/quizzes/${quiz.id}/edit`}>
              {t('edit')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/dashboard/quizzes/${quiz.id}/results`}>
              {t('results')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCopyLink}>
            {copied ? t('copy_link_copied') : t('copy_link')}
          </DropdownMenuItem>
          {/* QR Code：僅在有 accessCode 時顯示 */}
          {quiz.accessCode && (
            <DropdownMenuItem onClick={() => setShowQR(true)}>
              {t('qr_code')}
            </DropdownMenuItem>
          )}
          {quiz.status === 'published' && (
            <DropdownMenuItem onClick={handleStartLive} disabled={isPending}>
              🎮
              {' '}
              {t('start_live')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={handleDelete}
            disabled={isPending}
          >
            {t('delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {liveError && (
        <p className="mt-1 text-right text-xs text-destructive">{liveError}</p>
      )}

      {/* 分享 Modal */}
      {showQR && quiz.accessCode && (
        <ShareModal
          quizId={quiz.id}
          quizTitle={quiz.title}
          accessCode={quiz.accessCode}
          roomCode={quiz.roomCode}
          expiresAt={quiz.expiresAt instanceof Date ? quiz.expiresAt.toISOString() : (quiz.expiresAt ?? null)}
          onClose={() => setShowQR(false)}
        />
      )}
    </>
  );
}

export function useQuizColumns(): ColumnDef<Quiz>[] {
  const t = useTranslations('QuizTableColumns');

  return [
    {
      accessorKey: 'title',
      header: t('title_header'),
      cell: ({ row }) => (
        <Link
          href={`/dashboard/quizzes/${row.original.id}/edit`}
          className="font-medium hover:underline"
        >
          {row.original.title}
        </Link>
      ),
    },
    {
      accessorKey: 'status',
      header: t('status_header'),
      cell: ({ row }) => (
        <div className="whitespace-nowrap">
          <StatusBadge status={row.original.status} />
        </div>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: t('created_at_header'),
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {row.original.createdAt.toLocaleDateString('zh-TW')}
        </span>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <div className="whitespace-nowrap text-right">
          <ActionsCell quiz={row.original} />
        </div>
      ),
    },
  ];
}
