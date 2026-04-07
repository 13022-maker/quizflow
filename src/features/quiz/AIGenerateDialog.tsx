'use client';

import { useState, useTransition } from 'react';

import type { AIGeneratedQuestion } from '@/actions/aiActions';
import { generateAIQuestions } from '@/actions/aiActions';
import { Button } from '@/components/ui/button';

type Props = {
  isPro: boolean;
  onGenerated: (questions: AIGeneratedQuestion[]) => void;
};

/**
 * AI 出題按鈕 + 對話框
 * isPro=false 時點擊顯示升級提示
 */
export function AIGenerateDialog({ isPro, onGenerated }: Props) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(5);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleGenerate = () => {
    if (!topic.trim()) {
      setError('請輸入主題或內文');
      return;
    }
    setError('');
    startTransition(async () => {
      const result = await generateAIQuestions({ topic, count });
      if (result.success) {
        onGenerated(result.questions);
        setOpen(false);
        setTopic('');
      } else {
        setError(result.error);
      }
    });
  };

  // ── Free 用戶：顯示升級提示 ──────────────────────────────────────
  if (!isPro) {
    return (
      <div className="relative">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setOpen(v => !v)}
          className="gap-1.5"
        >
          <SparkleIcon />
          AI 出題
        </Button>

        {open && (
          <>
            {/* 背景遮罩 */}
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            {/* 提示卡片 */}
            <div className="absolute right-0 top-10 z-50 w-72 rounded-xl border bg-card p-5 shadow-lg">
              <div className="mb-3 flex items-center gap-2">
                <SparkleIcon className="size-5 text-indigo-500" />
                <span className="font-semibold">AI 自動出題</span>
              </div>
              <p className="mb-4 text-sm text-muted-foreground">
                輸入主題或一段文字，AI 立即幫你生成測驗題目。
                此功能為
                {' '}
                <strong>Pro 方案</strong>
                {' '}
                專屬功能。
              </p>
              <Button
                size="sm"
                className="w-full"
                onClick={() => {
                  window.location.href = '/dashboard/billing';
                }}
              >
                升級至 Pro 方案
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Pro 用戶：出題表單 ───────────────────────────────────────────
  return (
    <div className="relative">
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(v => !v)}
        disabled={isPending}
        className="gap-1.5"
      >
        <SparkleIcon />
        {isPending ? '生成中…' : 'AI 出題'}
      </Button>

      {open && (
        <>
          {/* 背景遮罩 */}
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div className="fixed inset-0 z-40" onClick={() => !isPending && setOpen(false)} />
          {/* 出題表單卡片 */}
          <div className="absolute right-0 top-10 z-50 w-80 rounded-xl border bg-card p-5 shadow-lg">
            <div className="mb-3 flex items-center gap-2">
              <SparkleIcon className="size-5 text-indigo-500" />
              <span className="font-semibold">AI 自動出題</span>
            </div>

            <div className="mb-3">
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label className="mb-1 block text-sm font-medium">
                主題或內容
              </label>
              <textarea
                value={topic}
                onChange={e => setTopic(e.target.value)}
                placeholder="例如：細胞分裂的原理與過程&#10;或貼上一段課文內容…"
                rows={4}
                disabled={isPending}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
            </div>

            <div className="mb-4 flex items-center gap-3">
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label className="shrink-0 text-sm font-medium">題數</label>
              <input
                type="number"
                min={1}
                max={10}
                value={count}
                onChange={e => setCount(Number(e.target.value))}
                disabled={isPending}
                className="w-16 rounded-md border bg-background px-2 py-1 text-center text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
              <span className="text-sm text-muted-foreground">題（最多 10）</span>
            </div>

            {error && (
              <p className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleGenerate}
                disabled={isPending}
                className="flex-1"
              >
                {isPending ? '生成中…' : '開始生成'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                取消
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// 簡單的 ✨ 圖示
function SparkleIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
    </svg>
  );
}
