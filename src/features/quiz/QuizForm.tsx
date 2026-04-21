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
  iconBg: string;
};

// 收起在「使用範本」區的預設標題範本（僅差別在預設標題文字）
const TITLE_TEMPLATES: TemplateItem[] = [
  { icon: '📝', title: '隨堂測驗', subtitle: '課中快速檢測', iconBg: 'bg-blue-100' },
  { icon: '📋', title: '期中考', subtitle: '完整章節評量', iconBg: 'bg-indigo-100' },
  { icon: '🔄', title: '複習小考', subtitle: '段考前鞏固記憶', iconBg: 'bg-sky-100' },
  { icon: '🎯', title: '自學挑戰', subtitle: '學生課後練習', iconBg: 'bg-amber-100' },
  { icon: '📖', title: '課前預習', subtitle: '熟悉新單元重點', iconBg: 'bg-emerald-100' },
  { icon: '💡', title: '知識檢測', subtitle: '檢測自我理解', iconBg: 'bg-yellow-100' },
];

// 真正不同流程的模式（單字記憶 = vocab mode）
const VOCAB_TEMPLATE: TemplateItem = {
  icon: '🔤',
  title: '單字記憶',
  subtitle: '中英單字反覆過關',
  description: '以下為單字記憶練習，看中文提示打出英文，答錯的單字會重新出現直到全部過關。',
  quizMode: 'vocab',
  iconBg: 'bg-rose-100',
};

function getDefaultTitle() {
  const d = new Date();
  return `新測驗 ${d.getMonth() + 1}/${d.getDate()}`;
}

export function QuizForm() {
  const [isPending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [customTitle, setCustomTitle] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [error, setError] = useState('');

  const runCreate = (key: string, data: Parameters<typeof createQuiz>[0]) => {
    setPendingKey(key);
    setError('');
    startTransition(async () => {
      const result = await createQuiz(data);
      if (result?.error) {
        setPendingKey(null);
        if (result.error === 'QUOTA_EXCEEDED') {
          window.location.href = '/dashboard/billing';
          return;
        }
        setError(result.error);
      }
    });
  };

  const handlePrimary = () => {
    const title = customTitle.trim() || getDefaultTitle();
    runCreate('primary', { title });
  };

  const handleTemplate = (tmpl: TemplateItem) => {
    runCreate(tmpl.title, {
      title: tmpl.title,
      description: tmpl.description,
      quizMode: tmpl.quizMode,
    });
  };

  const primaryLoading = pendingKey === 'primary';
  const vocabLoading = pendingKey === VOCAB_TEMPLATE.title;

  return (
    <div className="space-y-5">
      {/* 主要動線：輸入標題（選填）＋ 直接開始 */}
      <div className="space-y-3">
        <label htmlFor="quiz-title" className="block text-sm font-medium text-foreground">
          測驗標題
          <span className="ml-1 text-xs font-normal text-muted-foreground">（選填，之後可改）</span>
        </label>
        <input
          id="quiz-title"
          type="text"
          value={customTitle}
          onChange={e => setCustomTitle(e.target.value)}
          placeholder={`例如：第三章隨堂測驗（留空會自動帶入「${getDefaultTitle()}」）`}
          disabled={isPending}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handlePrimary();
            }
          }}
          className="w-full rounded-lg border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
        />
        <Button
          type="button"
          onClick={handlePrimary}
          disabled={isPending}
          className="h-12 w-full text-base font-semibold"
        >
          {primaryLoading ? '建立中…' : '✨ 直接開始建立'}
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* 次要：單字記憶模式（真的不同流程） */}
      <button
        type="button"
        disabled={isPending}
        onClick={() => handleTemplate(VOCAB_TEMPLATE)}
        className="group flex w-full items-center gap-3 rounded-xl border bg-card p-3.5 text-left transition-all hover:border-primary/40 hover:shadow-sm disabled:pointer-events-none disabled:opacity-60"
      >
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg text-lg ${VOCAB_TEMPLATE.iconBg}`}>
          {VOCAB_TEMPLATE.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">
            {vocabLoading ? '建立中…' : VOCAB_TEMPLATE.title}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {VOCAB_TEMPLATE.subtitle}
          </div>
        </div>
        <span className="text-xs text-muted-foreground group-hover:text-primary">→</span>
      </button>

      {/* 可折疊：預設標題範本（只差在標題文字，使用者有需要才展開） */}
      <div>
        <button
          type="button"
          onClick={() => setShowTemplates(v => !v)}
          className="flex w-full items-center justify-between rounded-lg px-1 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <span>使用預設標題範本</span>
          <span className={`transition-transform ${showTemplates ? 'rotate-180' : ''}`}>▾</span>
        </button>
        {showTemplates && (
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {TITLE_TEMPLATES.map((tmpl) => {
              const isLoading = pendingKey === tmpl.title;
              return (
                <button
                  key={tmpl.title}
                  type="button"
                  disabled={isPending}
                  onClick={() => handleTemplate(tmpl)}
                  className={`flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left transition-all hover:border-primary/40 hover:shadow-sm disabled:pointer-events-none disabled:opacity-60 ${
                    isLoading ? 'border-primary bg-primary/5' : 'border-border'
                  }`}
                >
                  <div className={`flex size-8 shrink-0 items-center justify-center rounded-md text-base ${tmpl.iconBg}`}>
                    {tmpl.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-foreground">
                      {isLoading ? '建立中…' : tmpl.title}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {tmpl.subtitle}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 提示 */}
      <div className="flex items-start gap-2.5 rounded-lg bg-primary/5 px-4 py-3">
        <svg className="mt-0.5 size-4 shrink-0 text-primary/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-xs leading-relaxed text-muted-foreground">
          建立後直接進入出題頁，可選
          {' '}
          <strong>AI 智慧出題</strong>
          或手動出題。
        </p>
      </div>
    </div>
  );
}
