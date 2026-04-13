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

  const priceId = billingCycle === 'yearly'
    ? plan.priceIdYearly
    : plan.priceIdMonthly;

  const displayPrice = billingCycle === 'yearly'
    ? plan.yearlyPrice
    : plan.monthlyPrice;

  const handleClick = () => {
    if (isFree) {
      window.location.href = '/sign-up';
      return;
    }
    openCheckout(priceId);
  };

  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-8 transition-all ${
        plan.highlighted
          ? 'border-blue-500 bg-blue-50 shadow-lg shadow-blue-100'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-md'
      }`}
    >
      {plan.highlighted && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-500 px-4 py-1 text-xs font-semibold text-white">
          最多老師選擇
        </span>
      )}

      <div className="mb-6">
        <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
        <p className="mt-1 text-sm text-gray-500">{plan.description}</p>
      </div>

      <div className="mb-6">
        <span className="text-4xl font-extrabold text-gray-900">
          $
          {displayPrice}
        </span>
        <span className="ml-1 text-sm text-gray-500">
          /
          {billingCycle === 'yearly' ? '年' : '月'}
        </span>
        {billingCycle === 'yearly' && !isFree && (
          <p className="mt-1 text-xs text-green-600">
            比月繳省
            {' '}
            {Math.round((1 - plan.yearlyPrice / (plan.monthlyPrice * 12)) * 100)}
            %
          </p>
        )}
      </div>

      <ul className="mb-8 flex-1 space-y-3">
        {plan.features.map(feature => (
          <li key={feature} className="flex items-start gap-2 text-sm text-gray-600">
            <span className="mt-0.5 text-blue-500">✓</span>
            {feature}
          </li>
        ))}
      </ul>

      {error && <p className="mb-3 text-xs text-red-500">{error}</p>}

      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className={`w-full rounded-xl py-3 text-sm font-semibold transition-all ${
          plan.highlighted
            ? 'bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-60'
            : 'border border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50 disabled:opacity-60'
        }`}
      >
        {loading ? '處理中...' : plan.ctaLabel}
      </button>
    </div>
  );
}
