'use client';

/**
 * PricingSection — 完整定價頁區塊
 * 月繳/年繳切換 + 三個方案卡片
 */

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { PricingPlan } from './PricingCard';
import { PricingCard } from './PricingCard';

// 文案走 i18n（PricingSection namespace）；價格 / priceId / ctaLabel 維持原樣
const getPlans = (t: ReturnType<typeof useTranslations>): PricingPlan[] => [
  {
    name: t('free_name'),
    description: t('free_description'),
    monthlyPrice: 0,
    yearlyPrice: 0,
    priceIdMonthly: '',
    priceIdYearly: '',
    features: [
      t('free_feature1'),
      t('free_feature2'),
      t('free_feature3'),
      t('free_feature4'),
      t('free_feature5'),
    ],
    ctaHint: t('free_cta_hint'),
    ctaLabel: '免費開始使用',
  },
  {
    name: t('pro_name'),
    description: t('pro_description'),
    monthlyPrice: 299,
    yearlyPrice: 2490,
    priceIdMonthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO_MONTHLY ?? '',
    priceIdYearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO_YEARLY ?? '',
    features: [
      t('pro_feature1'),
      t('pro_feature2'),
      t('pro_feature3'),
      t('pro_feature4'),
      t('pro_feature5'),
      t('pro_feature6'),
    ],
    ctaHint: t('pro_cta_hint'),
    highlighted: true,
    ctaLabel: '目前免費試用中',
  },
  {
    name: t('school_name'),
    description: t('school_description'),
    monthlyPrice: 1990,
    yearlyPrice: 16990,
    priceIdMonthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_TEAM_MONTHLY ?? '',
    priceIdYearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_TEAM_YEARLY ?? '',
    features: [
      t('school_feature1'),
      t('school_feature2'),
      t('school_feature3'),
    ],
    ctaHint: t('school_cta_hint'),
    ctaLabel: '目前免費試用中',
  },
];

export function PricingSection({ showPaidPlans }: { showPaidPlans: boolean }) {
  const t = useTranslations('PricingSection');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('yearly');
  const PLANS = getPlans(t);

  // showPaidPlans=false 時只顯示 Free（monthlyPrice === 0），true 時顯示完整 PLANS
  const visiblePlans = showPaidPlans ? PLANS : PLANS.filter(plan => plan.monthlyPrice === 0);

  return (
    <section className="px-4 py-24">
      <div className="mx-auto max-w-5xl">
        {/* 區塊標題 */}
        <div className="mb-14 text-center">
          <p className="mb-3 text-sm font-medium text-primary">{t('section_subtitle')}</p>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t('section_title')}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">
            {t('section_description')}
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
                  {cycle === 'monthly' ? t('billing_monthly') : t('billing_yearly')}
                  {cycle === 'yearly' && (
                    <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                      {t('billing_yearly_badge')}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 方案卡片：單卡置中、三卡三欄 */}
        <div className={`grid gap-6 md:items-stretch ${
          visiblePlans.length === 1 ? 'md:mx-auto md:max-w-md' : 'md:grid-cols-3'
        }`}
        >
          {visiblePlans.map(plan => (
            <PricingCard key={plan.name} plan={plan} billingCycle={billingCycle} />
          ))}
        </div>

        {/* 底部信任訊息 */}
        <p className="mt-10 text-center text-xs text-muted-foreground">
          付款由
          {' '}
          <span className="font-medium text-foreground/80">Paddle</span>
          {' '}
          安全處理 · 可隨時取消 · 不需綁約
        </p>
      </div>
    </section>
  );
}
