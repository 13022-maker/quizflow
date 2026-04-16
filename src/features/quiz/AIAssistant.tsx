'use client';

/**
 * AIAssistant — 學生考前 AI 助教（一題一卡解題提示）
 *
 * 流程：
 * 1. 進入時 POST /api/ai/generate-hints/[quizId] 取得所有題目的 AI 提示
 * 2. 一次顯示一題：題目 + ≤57 字 AI 提示
 * 3. 上一題 / 下一題 切換
 */

import type { InferSelectModel } from 'drizzle-orm';
import { useEffect, useState } from 'react';

import type { questionSchema } from '@/models/Schema';

type Question = InferSelectModel<typeof questionSchema>;

type Props = {
  quizId: number;
  questions: Question[];
  onExit: () => void;
};

export function AIAssistant({ quizId, questions, onExit }: Props) {
  const [index, setIndex] = useState(0);
  const [hints, setHints] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError('');
    fetch(`/api/ai/generate-hints/${quizId}`, { method: 'POST' })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          throw new Error(data?.error ?? '載入失敗');
        }
        return data;
      })
      .then((data) => {
        setHints(data.hints ?? {});
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'AI 助教暫時無法使用，請稍後再試');
      })
      .finally(() => setLoading(false));
  }, [quizId, retryKey]);

  const handleRetry = () => setRetryKey(k => k + 1);

  const current = questions[index];
  const total = questions.length;

  if (!current) {
    return null;
  }

  const currentHint = hints[current.id];

  return (
    <div className="space-y-5">
      {/* 頂部 */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onExit}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← 返回作答
        </button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {index + 1}
          {' '}
          /
          {' '}
          {total}
        </span>
      </div>

      {/* 標題 banner */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
        <p className="text-sm font-semibold text-primary">🤖 AI 助教</p>
        <p className="mt-1 text-xs text-muted-foreground">
          考前看一看每題的解題提示，幫助你理解概念
        </p>
      </div>

      {/* 題目卡片 */}
      <div className="rounded-xl border bg-card p-6">
        <div className="mb-4 flex items-start gap-3">
          <span className="shrink-0 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
            Q
            {index + 1}
          </span>
          <p className="font-medium leading-snug">{current.body}</p>
        </div>

        {current.imageUrl && (
          <div className="mb-4 flex items-center justify-center overflow-hidden rounded-lg border bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current.imageUrl} alt="題目圖片" className="max-h-[300px] w-full object-contain" />
          </div>
        )}

        {/* AI 提示 */}
        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="mb-2 text-xs font-semibold text-amber-800">💡 解題提示</p>
          {loading
            ? (
                <p className="text-sm text-amber-700">AI 助教思考中…</p>
              )
            : error
              ? (
                  <div className="space-y-2">
                    <p className="text-sm text-destructive">{error}</p>
                    <button
                      type="button"
                      onClick={handleRetry}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      🔄 重試
                    </button>
                  </div>
                )
              : currentHint
                ? (
                    <p className="text-sm leading-relaxed text-amber-900">{currentHint}</p>
                  )
                : (
                    <p className="text-sm text-muted-foreground">此題暫無提示</p>
                  )}
        </div>
      </div>

      {/* 上一題 / 下一題 */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setIndex(i => Math.max(0, i - 1))}
          disabled={index === 0}
          className="flex-1 rounded-lg border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          ← 上一題
        </button>
        <button
          type="button"
          onClick={() => setIndex(i => Math.min(total - 1, i + 1))}
          disabled={index === total - 1}
          className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
        >
          下一題 →
        </button>
      </div>

      {/* 底部離開 */}
      <button
        type="button"
        onClick={onExit}
        className="w-full rounded-lg border py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        結束 AI 助教，開始作答
      </button>
    </div>
  );
}
