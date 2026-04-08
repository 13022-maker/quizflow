'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

// 三個步驟的定義
const STEPS = [
  {
    number: 1,
    icon: '📝',
    title: '建立測驗',
    description: '點擊「建立新測驗」，輸入標題、新增題目（選擇題、是非題、問答題皆支援）。',
    action: { label: '立即建立', href: '/dashboard/quizzes/new' },
  },
  {
    number: 2,
    icon: '✨',
    title: '新增題目或 AI 出題',
    description: '手動新增題目，或升級 Pro 方案後上傳課本、簡報，讓 AI 自動生成試題並附解析。',
    action: null,
  },
  {
    number: 3,
    icon: '🔗',
    title: '分享連結給學生',
    description: '發佈測驗後複製專屬連結，貼到 LINE 或黑板，學生無需帳號即可作答。',
    action: null,
  },
] as const;

export function OnboardingSteps() {
  // 用 null 代表「尚未從 localStorage 讀取」，避免 hydration mismatch
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    setDismissed(localStorage.getItem('onboarding_done') === 'true');
  }, []);

  // 尚未讀取 localStorage 時不渲染（避免閃爍）
  if (dismissed === null || dismissed) {
    return null;
  }

  const handleDismiss = () => {
    localStorage.setItem('onboarding_done', 'true');
    setDismissed(true);
  };

  return (
    <div className="rounded-xl border bg-card p-6">
      {/* 標題列 */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">開始使用 QuizFlow</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            跟著以下步驟，幾分鐘內完成第一份測驗
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="text-xs text-muted-foreground hover:text-foreground"
          aria-label="關閉引導"
        >
          不再顯示
        </button>
      </div>

      {/* 步驟卡片 */}
      <div className="grid gap-4 sm:grid-cols-3">
        {STEPS.map(step => (
          <div
            key={step.number}
            className="relative rounded-lg border bg-muted/30 p-4"
          >
            {/* 步驟序號 */}
            <span className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {step.number}
            </span>

            {/* 圖示與標題 */}
            <div className="mb-2 text-2xl">{step.icon}</div>
            <h3 className="font-semibold">{step.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {step.description}
            </p>

            {/* 步驟一有快速操作按鈕 */}
            {step.action && (
              <Link
                href={step.action.href}
                className="mt-3 inline-block rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                {step.action.label}
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
