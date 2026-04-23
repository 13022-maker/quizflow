'use client';

// 測驗列表 / 空狀態的「建立新測驗」按鈕：
// 點下直接呼叫 createQuiz（以當日日期為預設標題），server action 成功會 redirect 到
// /dashboard/quizzes/[id]/edit?ai=1&just_created=1，AI Modal 自動開啟，
// 省掉中間 /new 頁面還要再填一次標題的步驟。
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { createQuiz } from '@/actions/quizActions';

function getDefaultTitle(): string {
  const d = new Date();
  return `AI 出題 ${d.getMonth() + 1}/${d.getDate()}`;
}

export function CreateQuizWithAIButton({
  className,
  children,
  pendingLabel = 'AI 出題準備中⋯',
}: {
  className?: string;
  children: React.ReactNode;
  pendingLabel?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleClick = () => {
    startTransition(async () => {
      const result = await createQuiz({ title: getDefaultTitle() });
      // server action 成功時會 server-side redirect，此分支只有失敗才會走到
      if (result?.error) {
        if (result.error === 'QUOTA_EXCEEDED') {
          router.push('/dashboard/billing');
          return;
        }
        // eslint-disable-next-line no-alert
        alert(result.error);
      }
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className={className}
    >
      {isPending ? pendingLabel : children}
    </button>
  );
}
