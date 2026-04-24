'use client';

// 從 /dashboard/billing 觸發 Paddle Checkout 的按鈕
// 提供月/年切換，年繳預設（audit 建議：default yearly 可提升年繳比例 +40–60%）
import { useState } from 'react';

import { useCheckout } from '@/hooks/useCheckout';

type Props = {
  priceIdMonthly?: string;
  priceIdYearly?: string;
  monthlyPriceTwd: number;
  yearlyPriceTwd: number;
};

export function UpgradeProButton({
  priceIdMonthly,
  priceIdYearly,
  monthlyPriceTwd,
  yearlyPriceTwd,
}: Props) {
  const { openCheckout, loading, error } = useCheckout();
  const [cycle, setCycle] = useState<'monthly' | 'yearly'>('yearly');

  const priceId = cycle === 'yearly' ? priceIdYearly : priceIdMonthly;
  const displayPrice = cycle === 'yearly' ? yearlyPriceTwd : monthlyPriceTwd;
  const ready = !!priceId;
  const yearlySaving
    = monthlyPriceTwd > 0
      ? Math.round((1 - yearlyPriceTwd / (monthlyPriceTwd * 12)) * 100)
      : 0;

  const handleClick = () => {
    if (!ready) {
      return;
    }
    openCheckout(priceId!);
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
      {cycle === 'yearly' && (
        <p className="-mt-2 text-xs text-muted-foreground">
          平均每月 NT$
          {Math.round(yearlyPriceTwd / 12).toLocaleString()}
          ，比月繳省 NT$
          {(monthlyPriceTwd * 12 - yearlyPriceTwd).toLocaleString()}
        </p>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* 主按鈕 */}
      <button
        type="button"
        onClick={handleClick}
        disabled={loading || !ready}
        className="w-full rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
      >
        {loading ? '處理中⋯' : !ready ? '付款設定未完成' : '立即升級 Pro'}
      </button>

      {!ready && (
        <p className="text-center text-xs text-muted-foreground">
          尚未設定 Paddle Price ID（環境變數 NEXT_PUBLIC_PADDLE_PRICE_PRO_*）
        </p>
      )}
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
