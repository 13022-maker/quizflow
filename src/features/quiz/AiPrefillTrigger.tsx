'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { createQuiz } from '@/actions/quizActions';

// 由市集空狀態 CTA 進入 /dashboard/quizzes/new?ai=1[&prefill=...]
// mount 後立刻呼叫 createQuiz(server action),成功時 server-side redirect 到 edit?ai=1&prefill=...
// 失敗時(quota 超額 / 其他)在畫面顯示錯誤 + 返回連結
function getDefaultTitle(): string {
  const d = new Date();
  return `AI 出題 ${d.getMonth() + 1}/${d.getDate()}`;
}

export function AiPrefillTrigger({ prefill }: { prefill: string }) {
  const router = useRouter();
  // Strict Mode dev double-mount guard
  const firedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (firedRef.current) {
      return;
    }
    firedRef.current = true;

    (async () => {
      const result = await createQuiz({
        title: getDefaultTitle(),
        prefill: prefill || undefined,
      });
      // 成功時 server action 會 redirect(throw NEXT_REDIRECT),不會 return
      // 走到這裡代表失敗
      if (result?.error === 'QUOTA_EXCEEDED') {
        router.push('/dashboard/billing');
        return;
      }
      if (result?.error) {
        setError(result.error);
      }
    })();
  }, [prefill, router]);

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-sm text-red-600">
          建立失敗：
          {error}
        </p>
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          返回儀表板
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      {/* 紫色 spinner 呼應 QuickCreateAIButton 視覺 */}
      <div className="mx-auto mb-4 size-12 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600" />
      <h1 className="text-lg font-bold text-foreground">準備 AI 命題中⋯</h1>
      {prefill && (
        <p className="mt-2 text-sm text-muted-foreground">
          主題：
          <span className="font-medium text-foreground">{prefill}</span>
        </p>
      )}
    </div>
  );
}
