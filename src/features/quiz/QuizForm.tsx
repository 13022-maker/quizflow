'use client';

import { useState, useTransition } from 'react';

import { createQuiz } from '@/actions/quizActions';
import { Button } from '@/components/ui/button';

type TemplateItem = {
  label: string;
  title: string;
  description?: string;
  quizMode?: 'standard' | 'vocab';
};

const TEMPLATE_GROUPS: { label: string; items: TemplateItem[] }[] = [
  {
    label: '考試測驗',
    items: [
      { label: '📝 隨堂測驗', title: '隨堂測驗' },
      { label: '📋 期中考', title: '期中考' },
      { label: '🔄 複習小考', title: '複習小考' },
    ],
  },
  {
    label: '自學練習',
    items: [
      { label: '🎯 自學挑戰', title: '自學挑戰' },
      { label: '📖 課前預習', title: '課前預習' },
      { label: '💡 知識檢測', title: '知識檢測' },
      {
        label: '🔤 單字記憶',
        title: '單字記憶',
        description: '以下為單字記憶練習，看中文提示打出英文，答錯的單字會重新出現直到全部過關。',
        quizMode: 'vocab',
      },
    ],
  },
];

export function QuizForm() {
  const [isPending, startTransition] = useTransition();
  const [pendingTemplate, setPendingTemplate] = useState<string | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [error, setError] = useState('');

  const handleTemplateClick = (tmpl: TemplateItem) => {
    setPendingTemplate(tmpl.title);
    setError('');
    startTransition(async () => {
      const result = await createQuiz({
        title: tmpl.title,
        description: tmpl.description,
        quizMode: tmpl.quizMode,
      });
      if (result?.error) {
        setPendingTemplate(null);
        if (result.error === 'QUOTA_EXCEEDED') {
          window.location.href = '/dashboard/billing';
          return;
        }
        setError(result.error);
      }
    });
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customTitle.trim()) {
      setError('請輸入測驗標題');
      return;
    }
    setError('');
    startTransition(async () => {
      const result = await createQuiz({ title: customTitle.trim() });
      if (result?.error) {
        if (result.error === 'QUOTA_EXCEEDED') {
          window.location.href = '/dashboard/billing';
          return;
        }
        setError(result.error);
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* 引導文字 */}
      <p className="text-sm text-muted-foreground">
        選一個快速開始，標題和設定之後都能改
      </p>

      {/* 快速範本 — 一鍵建立 */}
      <div className="space-y-4">
        {TEMPLATE_GROUPS.map(group => (
          <div key={group.label}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
            <div className="flex flex-wrap gap-2">
              {group.items.map(tmpl => (
                <button
                  key={tmpl.title}
                  type="button"
                  disabled={isPending}
                  onClick={() => handleTemplateClick(tmpl)}
                  className={`rounded-lg border-2 px-4 py-2.5 text-sm font-medium transition-all hover:-translate-y-0.5 hover:shadow-sm disabled:opacity-50 ${
                    pendingTemplate === tmpl.title
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-transparent bg-muted/60 text-foreground hover:border-muted-foreground/20'
                  }`}
                >
                  {pendingTemplate === tmpl.title ? '建立中…' : tmpl.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* 自行輸入（預設收起） */}
      {!showCustom
        ? (
            <button
              type="button"
              onClick={() => setShowCustom(true)}
              className="w-full rounded-lg border border-dashed border-muted-foreground/30 py-3 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              ✏️ 自行輸入標題
            </button>
          )
        : (
            <form onSubmit={handleCustomSubmit} className="space-y-3 rounded-xl border bg-card p-4">
              <input
                type="text"
                value={customTitle}
                onChange={e => setCustomTitle(e.target.value)}
                placeholder="輸入測驗標題，例如：第三章隨堂測驗"
                className="w-full rounded-lg border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <div className="flex gap-2">
                <Button type="submit" disabled={isPending} size="sm">
                  {isPending ? '建立中…' : '建立測驗'}
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCustom(false);
                    setCustomTitle('');
                  }}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  取消
                </button>
              </div>
            </form>
          )}

      {/* 提示 */}
      <div className="flex items-start gap-2.5 rounded-lg bg-primary/5 px-4 py-3">
        <svg className="mt-0.5 size-4 shrink-0 text-primary/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-xs leading-relaxed text-muted-foreground">
          點選後直接進入出題頁面，可用
          {' '}
          <strong>AI 智慧出題</strong>
          或手動出題。不只考試，也適合學生自學練習。
        </p>
      </div>
    </div>
  );
}
