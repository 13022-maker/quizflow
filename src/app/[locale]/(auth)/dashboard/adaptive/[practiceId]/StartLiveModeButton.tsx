'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createLiveGameFromAdaptivePractice } from '@/actions/adaptiveActions';

/**
 * 「開始 Live 測驗」按鈕：從這個練習所屬學科的題庫隨機抽題，快照成一份測驗，
 * 直接開一場 Live Mode（比照 QuizEditor 呼叫 createLiveGame 的 error-handling 寫法）。
 */
export function StartLiveModeButton({ practiceId, itemCount }: { practiceId: number; itemCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [questionCount, setQuestionCount] = useState(Math.min(10, itemCount));
  const [questionDuration, setQuestionDuration] = useState(20);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await createLiveGameFromAdaptivePractice(practiceId, {
        questionCount,
        questionDuration,
      });
      if (!res || typeof res !== 'object') {
        setError('Live Mode 建立失敗：伺服器未回應（可能需重新登入）');
        return;
      }
      if ('error' in res) {
        setError(res.error ?? '建立失敗');
        return;
      }
      if (!('gameId' in res)) {
        setError('Live Mode 建立失敗：伺服器回傳異常');
        return;
      }
      router.push(`/dashboard/live/host/${res.gameId}`);
    } catch (err) {
      setError(err instanceof Error ? `Live Mode 建立失敗：${err.message}` : 'Live Mode 建立失敗，請稍後再試');
    } finally {
      setIsLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
      >
        🎮 開始 Live 測驗
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5 rounded-lg border bg-card p-3 shadow-sm">
      <div className="flex flex-wrap items-end gap-2.5">
        <div className="flex flex-col gap-1">
          <label htmlFor="live-question-count" className="text-xs font-medium text-muted-foreground">
            題目數量（題庫共
            {' '}
            {itemCount}
            {' '}
            題）
          </label>
          <input
            id="live-question-count"
            type="number"
            min={3}
            max={Math.min(30, itemCount)}
            value={questionCount}
            onChange={e => setQuestionCount(Number(e.target.value))}
            className="h-8 w-20 rounded-md border px-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="live-question-duration" className="text-xs font-medium text-muted-foreground">
            每題秒數
          </label>
          <input
            id="live-question-duration"
            type="number"
            min={5}
            max={120}
            value={questionDuration}
            onChange={e => setQuestionDuration(Number(e.target.value))}
            className="h-8 w-20 rounded-md border px-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <button
          type="button"
          onClick={handleStart}
          disabled={isLoading}
          className="h-8 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {isLoading ? '建立中…' : '開始'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={isLoading}
          className="h-8 rounded-lg px-2 text-sm text-muted-foreground hover:bg-muted"
        >
          取消
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
