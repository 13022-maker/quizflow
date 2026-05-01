'use client';

import { SignedIn, SignedOut } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { forkByAccessCode } from '@/actions/forkActions';
import { Button } from '@/components/ui/button';

type Props = {
  accessCode: string;
};

export function ForkPreviewClient({ accessCode }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleFork = () => {
    setError(null);
    startTransition(async () => {
      const res = await forkByAccessCode(accessCode);
      // self-fork(擁有者點自己的連結)會在這條路徑回 { error: '無法 fork 自己的測驗' }
      if ('error' in res && res.error) {
        setError(res.error);
        return;
      }
      if ('newQuizId' in res && res.newQuizId) {
        router.push(`/dashboard/quizzes/${res.newQuizId}/edit`);
      }
    });
  };

  // sign-in 後 callback 回到本頁,Clerk 會自動帶 redirect_url
  const callback = encodeURIComponent(`/quiz/${accessCode}/fork`);

  return (
    <>
      {/* 已登入:直接 fork */}
      <SignedIn>
        <div className="mt-4">
          <Button
            type="button"
            onClick={handleFork}
            disabled={isPending}
            className="w-full"
          >
            {isPending ? '複製中…' : '📋 複製到我的測驗'}
          </Button>
          {error && (
            <p className="mt-2 text-center text-xs text-red-600">{error}</p>
          )}
        </div>
      </SignedIn>

      {/* 未登入:引導登入,callback 回本頁 */}
      <SignedOut>
        <div className="mt-4">
          <a
            href={`/sign-in?redirect_url=${callback}`}
            className="block w-full rounded-lg bg-gray-900 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-gray-800"
          >
            🔐 登入後複製到我的測驗
          </a>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            老師專用 · 免費註冊
          </p>
        </div>
      </SignedOut>
    </>
  );
}
