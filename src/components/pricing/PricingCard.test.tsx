// 定價卡按鈕狀態：學校方案上線時不設 TEAM price env → 卡片要顯示「即將開放」且不能點
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PricingPlan } from './PricingCard';

const openCheckoutMock = vi.fn();

vi.mock('@/hooks/useCheckout', () => ({
  useCheckout: () => ({ openCheckout: openCheckoutMock, loading: false, error: null }),
}));

const { PricingCard } = await import('./PricingCard');

function schoolPlan(priceIds: { monthly: string; yearly: string }): PricingPlan {
  return {
    name: '學校方案',
    description: '適合整個學校或教學團隊',
    monthlyPrice: 1990,
    yearlyPrice: 16990,
    priceIdMonthly: priceIds.monthly,
    priceIdYearly: priceIds.yearly,
    features: ['最多 30 位老師帳號'],
    ctaLabel: '聯絡我們',
  };
}

describe('PricingCard 付費方案按鈕', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_PADDLE_CLIENT_TOKEN', 'live_token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    openCheckoutMock.mockReset();
  });

  it('TEAM price env 未設（空字串）→ 月繳顯示「即將開放」且 disabled', () => {
    render(<PricingCard plan={schoolPlan({ monthly: '', yearly: '' })} billingCycle="monthly" />);
    const button = screen.getByRole('button', { name: '即將開放' });

    expect(button).toBeDisabled();
  });

  it('TEAM price env 未設（空字串）→ 年繳也顯示「即將開放」且 disabled', () => {
    render(<PricingCard plan={schoolPlan({ monthly: '', yearly: '' })} billingCycle="yearly" />);
    const button = screen.getByRole('button', { name: '即將開放' });

    expect(button).toBeDisabled();
  });

  it('price 與 client token 都有 → 顯示「立即訂閱」可點', () => {
    render(<PricingCard plan={schoolPlan({ monthly: 'pri_team_m', yearly: 'pri_team_y' })} billingCycle="monthly" />);
    const button = screen.getByRole('button', { name: '立即訂閱' });

    expect(button).toBeEnabled();
  });
});
