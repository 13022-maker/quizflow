'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

// 三個步驟的定義（文案走 i18n：Onboarding namespace）
const STEPS = [
  {
    number: 1,
    icon: '📝',
    key: 'step1',
    action: { href: '/dashboard/quizzes/new' },
  },
  {
    number: 2,
    icon: '✨',
    key: 'step2',
    action: null,
  },
  {
    number: 3,
    icon: '🔗',
    key: 'step3',
    action: null,
  },
] as const;

export function OnboardingSteps() {
  const t = useTranslations('Onboarding');
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
          <h2 className="text-lg font-semibold">{t('title')}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t('subtitle')}
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="text-xs text-muted-foreground hover:text-foreground"
          aria-label={t('dismiss_aria')}
        >
          {t('dismiss')}
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
            <h3 className="font-semibold">{t(`${step.key}_title`)}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {t(`${step.key}_description`)}
            </p>

            {/* 步驟一有快速操作按鈕 */}
            {step.action && (
              <Link
                href={step.action.href}
                className="mt-3 inline-block rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                {t('step1_action')}
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
