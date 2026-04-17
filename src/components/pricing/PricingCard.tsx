'use client';

/**
 * PricingCard — 單一方案定價卡片
 * 點擊按鈕觸發 Paddle Checkout overlay（免費方案導向註冊頁）
 */

import { useCheckout } from '@/hooks/useCheckout';

export type PricingPlan = {
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  priceIdMonthly: string;
  priceIdYearly: string;
  features: string[];
  highlighted?: boolean;
  ctaLabel: string;
};

type Props = {
  plan: PricingPlan;
  billingCycle: 'monthly' | 'yearly';
};

export function PricingCard({ plan, billingCycle }: Props) {
  const { openCheckout, loading, error } = useCheckout();
  const isFree = plan.monthlyPrice === 0;

  const priceId = billingCycle === 'yearly' ? plan.priceIdYearly : plan.priceIdMonthly;
  const displayPrice = billingCycle === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice;

  // Paddle production 環境變數未設時，付費方案按鈕 disabled
  const paddleReady = !!priceId;

  const handleClick = () => {
    if (isFree) {
      window.location.href = '/sign-up';
      return;
    }
    if (!paddleReady) {
      return;
    }
    openCheckout(priceId);
  };

  // 年繳省多少百分比（排除免費方案）
  const yearlySavingPercent
    = billingCycle === 'yearly' && !isFree
      ? Math.round((1 - plan.yearlyPrice / (plan.monthlyPrice * 12)) * 100)
      : null;

  return (
    <div
      className={`relative flex flex-col rounded-2xl border bg-card p-8 transition-all ${
        plan.highlighted
          ? 'border-primary/60 shadow-md ring-1 ring-primary/30'
          : 'hover:border-foreground/20 hover:shadow-sm'
      }`}
    >
      {plan.highlighted && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-1 text-xs font-medium text-primary-foreground shadow-sm">
          最多老師選擇
        </span>
      )}

      {/* 方案名稱與描述 */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold tracking-tight text-foreground">{plan.name}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{plan.description}</p>
      </div>

      {/* 價格區 */}
      <div className="mb-7">
        <div className="flex items-baseline gap-1">
          <span className="text-sm font-medium text-muted-foreground">NT$</span>
          <span className="text-4xl font-bold tabular-nums tracking-tight text-foreground">
            {displayPrice.toLocaleString()}
          </span>
          <span className="text-sm text-muted-foreground">
            /
            {billingCycle === 'yearly' ? '年' : '月'}
          </span>
        </div>
        {yearlySavingPercent !== null && (
          <p className="mt-1.5 text-xs font-medium text-primary">
            比月繳省
            {' '}
            {yearlySavingPercent}
            %
          </p>
        )}
      </div>

      {/* 功能列表 */}
      <ul className="mb-8 flex-1 space-y-3">
        {plan.features.map(feature => (
          <li key={feature} className="flex items-start gap-2.5 text-sm leading-relaxed text-foreground/80">
            <svg
              className="mt-0.5 size-4 shrink-0 text-primary"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M16.704 5.29a1 1 0 0 1 .006 1.415l-7.2 7.2a1 1 0 0 1-1.42 0l-3.6-3.6a1 1 0 0 1 1.42-1.414l2.89 2.89 6.49-6.49a1 1 0 0 1 1.414-.001z"
                clipRule="evenodd"
              />
            </svg>
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      {error && <p className="mb-3 text-xs text-destructive">{error}</p>}

      <button
        type="button"
        onClick={handleClick}
        disabled={loading || (!isFree && !paddleReady)}
        className={`w-full rounded-xl py-3 text-sm font-semibold transition-colors disabled:opacity-60 ${
          plan.highlighted
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'border bg-card text-foreground hover:border-foreground/30 hover:bg-muted/40'
        }`}
      >
        {loading ? '處理中...' : plan.ctaLabel}
      </button>
    </div>
  );
}
