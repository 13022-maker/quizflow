'use client';

/**
 * PricingSection — 完整定價頁區塊
 * 月繳/年繳切換 + 三個方案卡片
 */

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { PricingPlan } from './PricingCard';
import { PricingCard } from './PricingCard';

export function PricingSection() {
  const t = useTranslations('PricingExtra');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('yearly');

  // 方案的特色條目維持中文（之後搬進 json），但名稱／描述／CTA 由 i18n 管理
  const PLANS: PricingPlan[] = [
    {
      name: t('free_name'),
      description: t('free_description'),
      monthlyPrice: 0,
      yearlyPrice: 0,
      priceIdMonthly: '',
      priceIdYearly: '',
      features: [
        '每月 5 份試卷',
        'AI 自動出題（每份最多 10 題）',
        '基本題型：選擇、是非',
        '匯出 PDF',
      ],
      ctaLabel: t('free_cta'),
    },
    {
      name: t('pro_name'),
      description: t('pro_description'),
      monthlyPrice: 299,
      yearlyPrice: 2490,
      priceIdMonthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO_MONTHLY ?? '',
      priceIdYearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO_YEARLY ?? '',
      features: [
        '無限份試卷',
        'AI 出題無上限，3 分鐘生成 20 題',
        '全題型：選擇、填空、排序、申論',
        '自動對齊課綱',
        '學生學習狀況分析',
        '匯出 Word / PDF',
      ],
      highlighted: true,
      ctaLabel: t('pro_cta'),
    },
    {
      name: t('school_name'),
      description: t('school_description'),
      monthlyPrice: 1990,
      yearlyPrice: 16990,
      priceIdMonthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_TEAM_MONTHLY ?? '',
      priceIdYearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_TEAM_YEARLY ?? '',
      features: [
        '最多 30 位老師帳號',
        'Pro 方案所有功能',
        '學校題庫共享',
        '班級 / 年級統計報表',
        '專屬客服支援',
      ],
      ctaLabel: t('school_cta'),
    },
  ];

  return (
    <section className="px-4 py-24">
      <div className="mx-auto max-w-5xl">
        {/* 區塊標題 */}
        <div className="mb-14 text-center">
          <p className="mb-3 text-sm font-medium text-primary">{t('section_badge')}</p>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t('section_heading')}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">
            {t('section_subtitle')}
          </p>

          {/* 月繳/年繳切換 */}
          <div className="mt-8 inline-flex items-center rounded-full border bg-muted/40 p-1">
            {(['monthly', 'yearly'] as const).map((cycle) => {
              const isActive = billingCycle === cycle;
              return (
                <button
                  key={cycle}
                  type="button"
                  onClick={() => setBillingCycle(cycle)}
                  className={`rounded-full px-5 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {cycle === 'monthly' ? t('cycle_monthly') : t('cycle_yearly')}
                  {cycle === 'yearly' && (
                    <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                      {t('save_most')}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 三個方案卡片（手機單欄、桌機三欄，正中間 highlighted 放第二張） */}
        <div className="grid gap-6 md:grid-cols-3 md:items-stretch">
          {PLANS.map(plan => (
            <PricingCard key={plan.name} plan={plan} billingCycle={billingCycle} />
          ))}
        </div>

        {/* 底部信任訊息 */}
        <p className="mt-10 text-center text-xs text-muted-foreground">
          {t('footer_prefix')}
          {' '}
          <span className="font-medium text-foreground/80">Paddle</span>
          {' '}
          {t('footer_suffix')}
        </p>
      </div>
    </section>
  );
}
