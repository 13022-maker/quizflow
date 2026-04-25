'use client';

/**
 * useCheckout — 呼叫 Paddle Checkout overlay 的 hook
 * 1. POST /api/paddle/checkout 取得 Paddle 客戶 ID
 * 2. 用 Paddle.js 開啟 checkout overlay
 */

import { getPaddleInstance } from '@paddle/paddle-js';
import { track } from '@vercel/analytics';
import { useState } from 'react';

export function useCheckout() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openCheckout = async (priceId: string) => {
    setLoading(true);
    setError(null);

    // 追蹤付費漏斗起點；包 try/catch 避免 analytics 錯誤中斷結帳
    try {
      track('checkout_opened', { price_id: priceId });
    } catch (err) {
      console.error('[analytics] checkout_opened track failed', err);
    }

    try {
      const res = await fetch('/api/paddle/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? '結帳初始化失敗');
      }

      const { customerId } = await res.json();
      const paddleInstance = getPaddleInstance();

      paddleInstance?.Checkout.open({
        customer: { id: customerId },
        items: [{ priceId, quantity: 1 }],
        settings: {
          successUrl: `${window.location.origin}/dashboard?checkout=success`,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '結帳失敗');
    } finally {
      setLoading(false);
    }
  };

  return { openCheckout, loading, error };
}
