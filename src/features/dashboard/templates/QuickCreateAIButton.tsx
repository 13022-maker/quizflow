'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { createQuiz } from '@/actions/quizActions';

// Dashboard 的「AI 智慧出題」卡片：直接 createQuiz（用當日日期為預設標題），成功後
// createQuiz 的 server-side redirect 會把使用者帶到 /edit?ai=1&just_created=1，AI Modal 自動開啟。
// 省略原本要先進 /dashboard/quizzes/new 填標題再跳轉的那一步。
function getDefaultTitle(): string {
  const d = new Date();
  return `AI 出題 ${d.getMonth() + 1}/${d.getDate()}`;
}

export function QuickCreateAIButton() {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleClick = () => {
    startTransition(async () => {
      const result = await createQuiz({ title: getDefaultTitle() });
      // server action 成功時會 redirect（throw NEXT_REDIRECT），此處不會執行到
      // 只有失敗時才有 return value
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
      className="group flex items-start gap-4 rounded-xl border-2 border-transparent bg-card p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md disabled:pointer-events-none disabled:opacity-70"
    >
      <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600 transition-colors group-hover:bg-violet-600 group-hover:text-white">
        <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] font-bold text-foreground">
          {isPending ? 'AI 出題準備中⋯' : 'AI 智慧出題'}
        </h3>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          上傳講義或輸入主題，AI 自動生成試題
        </p>
      </div>
      {isPending
        ? (
            <svg className="mt-1 size-4 shrink-0 animate-spin text-violet-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          )
        : (
            <svg className="mt-1 size-4 shrink-0 text-muted-foreground/30 transition-all group-hover:translate-x-0.5 group-hover:text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          )}
    </button>
  );
}
