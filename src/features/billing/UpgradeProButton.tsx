'use client';

/**
 * /dashboard/billing 的 Pro 升級按鈕（重新實作舊 PR #32，以 main 現況為準）
 * - 月 / 年切換，預設年繳
 * - Paddle env（client token / price ID）未設時按鈕 disabled 並顯示「即將開放」
 */

import { useState } from 'react';

import { useCheckout } from '@/hooks/useCheckout';
import { isPaddleClientReady, readPaddlePublicEnv } from '@/libs/paddleConfig';

type Props = {
  monthlyPriceTwd: number;
  yearlyPriceTwd: number;
};

export function UpgradeProButton({ monthlyPriceTwd, yearlyPriceTwd }: Props) {
  const { openCheckout, loading, error } = useCheckout();
  const [cycle, setCycle] = useState<'monthly' | 'yearly'>('yearly');

  const { clientToken, priceIds } = readPaddlePublicEnv();
  const priceId = cycle === 'yearly' ? priceIds.proYearly : priceIds.proMonthly;
  const ready = isPaddleClientReady({ clientToken, priceId });

  const displayPrice = cycle === 'yearly' ? yearlyPriceTwd : monthlyPriceTwd;
  const yearlySaving = monthlyPriceTwd > 0
    ? Math.round((1 - yearlyPriceTwd / (monthlyPriceTwd * 12)) * 100)
    : 0;

  const handleClick = () => {
    if (!ready || !priceId) {
      return;
    }
    openCheckout(priceId);
  };

  return (
    <div className="space-y-4">
      {/* 月/年切換 */}
      <div className="inline-flex gap-1 rounded-lg border bg-muted/40 p-1 text-xs">
        <CycleButton active={cycle === 'monthly'} onClick={() => setCycle('monthly')}>
          月繳
        </CycleButton>
        <CycleButton active={cycle === 'yearly'} onClick={() => setCycle('yearly')}>
          年繳
          {yearlySaving > 0 && (
            <span className="ml-1.5 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold text-primary">
              省
              {yearlySaving}
              %
            </span>
          )}
        </CycleButton>
      </div>

      {/* 價格顯示 */}
      <div className="flex items-baseline gap-1">
        <span className="text-sm font-medium text-muted-foreground">NT$</span>
        <span className="text-4xl font-bold tabular-nums tracking-tight">
          {displayPrice.toLocaleString()}
        </span>
        <span className="text-sm text-muted-foreground">
          /
          {cycle === 'yearly' ? '年' : '月'}
        </span>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <button
        type="button"
        onClick={handleClick}
        disabled={loading || !ready}
        className="w-full rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
      >
        {loading ? '處理中...' : ready ? '立即升級 Pro' : '即將開放'}
      </button>

      <p className="text-center text-xs text-muted-foreground">
        付款由 Paddle 安全處理 · 可隨時取消
      </p>
    </div>
  );
}

function CycleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}
