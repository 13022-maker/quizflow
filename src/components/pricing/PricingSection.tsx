'use client';

/**
 * PricingSection — 完整定價頁區塊
 * 月繳/年繳切換 + 三個方案卡片
 */

import { useState } from 'react';

import type { PricingPlan } from './PricingCard';
import { PricingCard } from './PricingCard';

const PLANS: PricingPlan[] = [
  {
    name: '免費試用',
    description: '先試試看，不需要信用卡，出一張卷子再決定',
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
    ctaLabel: '免費開始使用',
  },
  {
    name: 'Pro 老師',
    description: '一個月的訂閱費，抵不上你一個週末的備課時間',
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
    ctaLabel: '開始 14 天免費試用',
  },
  {
    name: '學校方案',
    description: '全校老師一起用，行政組長再也不用催交考卷',
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
    ctaLabel: '聯絡我們了解方案',
  },
];

export function PricingSection() {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('yearly');

  return (
    <section className="px-4 py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-extrabold text-gray-900">
            每個月省下的備課時間，比訂閱費值錢多了
          </h2>
          <p className="mt-3 text-gray-500">選擇適合你的方案，隨時可以升級或取消</p>

          {/* 月繳/年繳切換 */}
          <div className="mt-6 inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1">
            {(['monthly', 'yearly'] as const).map(cycle => (
              <button
                key={cycle}
                type="button"
                onClick={() => setBillingCycle(cycle)}
                className={`rounded-lg px-5 py-2 text-sm font-medium transition-all ${
                  billingCycle === cycle
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {cycle === 'monthly' ? '月繳' : '年繳'}
                {cycle === 'yearly' && (
                  <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                    省最多
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* 三個方案卡片 */}
        <div className="grid gap-6 md:grid-cols-3">
          {PLANS.map(plan => (
            <PricingCard key={plan.name} plan={plan} billingCycle={billingCycle} />
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-gray-400">
          付款由 Paddle 安全處理 · 可隨時取消 · 不需綁約
        </p>
      </div>
    </section>
  );
}
