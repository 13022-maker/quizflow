'use client';

import { useState, useTransition } from 'react';

import { createQuiz } from '@/actions/quizActions';
import { Button } from '@/components/ui/button';

type TemplateItem = {
  icon: string;
  title: string;
  subtitle: string;
  description?: string;
  quizMode?: 'standard' | 'vocab';
  iconBg: string; // icon 圓形底色（Tailwind class）
};

// 範本分組：考試測驗（偏正式、冷色系）、自學練習（偏輕鬆、暖色系）
const TEMPLATE_GROUPS: { label: string; items: TemplateItem[] }[] = [
  {
    label: '考試測驗',
    items: [
      { icon: '📝', title: '隨堂測驗', subtitle: '課中快速檢測，5–10 題剛好', iconBg: 'bg-blue-100' },
      { icon: '📋', title: '期中考', subtitle: '完整章節評量，含各題型', iconBg: 'bg-indigo-100' },
      { icon: '🔄', title: '複習小考', subtitle: '段考前鞏固記憶', iconBg: 'bg-sky-100' },
    ],
  },
  {
    label: '自學練習',
    items: [
      { icon: '🎯', title: '自學挑戰', subtitle: '學生課後自主練習', iconBg: 'bg-amber-100' },
      { icon: '📖', title: '課前預習', subtitle: '先熟悉新單元重點', iconBg: 'bg-emerald-100' },
      { icon: '💡', title: '知識檢測', subtitle: '檢測自我理解程度', iconBg: 'bg-yellow-100' },
      {
        icon: '🔤',
        title: '單字記憶',
        subtitle: '中英單字反覆過關',
        description: '以下為單字記憶練習，看中文提示打出英文，答錯的單字會重新出現直到全部過關。',
        quizMode: 'vocab',
        iconBg: 'bg-rose-100',
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
    <div className="space-y-7">
      {/* 引導文字 */}
      <p className="text-sm text-muted-foreground">
        選一個快速開始，標題與設定之後都能再調整
      </p>

      {/* 快速範本 — 一鍵建立（卡片網格） */}
      <div className="space-y-6">
        {TEMPLATE_GROUPS.map(group => (
          <div key={group.label}>
            {/* 分組標題 + 分隔線 */}
            <div className="mb-3 flex items-center gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </h3>
              <div className="h-px flex-1 bg-border" />
            </div>

            {/* 卡片網格：手機 1 欄、平板 2 欄、桌面 3 欄 */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((tmpl) => {
                const isLoading = pendingTemplate === tmpl.title;
                return (
                  <button
                    key={tmpl.title}
                    type="button"
                    disabled={isPending}
                    onClick={() => handleTemplateClick(tmpl)}
                    className={`group relative flex items-start gap-3 rounded-xl border bg-card p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md disabled:pointer-events-none disabled:opacity-60 ${
                      isLoading ? 'border-primary bg-primary/5' : 'border-border'
                    }`}
                  >
                    {/* icon 圓形底色 */}
                    <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg text-lg ${tmpl.iconBg}`}>
                      {tmpl.icon}
                    </div>
                    {/* 標題 + 副標 */}
                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="text-sm font-semibold text-foreground">
                        {isLoading ? '建立中…' : tmpl.title}
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {tmpl.subtitle}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* 自行輸入（預設收起，虛線大卡） */}
      {!showCustom
        ? (
            <button
              type="button"
              onClick={() => setShowCustom(true)}
              className="group flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-5 text-sm font-medium text-muted-foreground transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
            >
              <span className="text-base">✏️</span>
              自行輸入測驗標題
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
