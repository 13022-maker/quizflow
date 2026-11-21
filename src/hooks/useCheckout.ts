'use client';

/**
 * useCheckout — 呼叫 Paddle Checkout overlay 的 hook
 * 1. POST /api/paddle/checkout 取得 Paddle 客戶 ID
 * 2. 用 Paddle.js 開啟 checkout overlay
 */

import { getPaddleInstance } from '@paddle/paddle-js';
import { useState } from 'react';

export function useCheckout() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openCheckout = async (priceId: string) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/paddle/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        // 訪客在定價頁點訂閱 → 先登入，登入後回到原頁
        window.location.href = `/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`;
        return;
      }
      if (!res.ok) {
        throw new Error(data.error ?? '結帳初始化失敗');
      }

      const paddleInstance = getPaddleInstance();
      if (!paddleInstance) {
        // PaddleProvider 未初始化（多半是 NEXT_PUBLIC_PADDLE_CLIENT_TOKEN 未設定）
        throw new Error('付款元件尚未載入，請重新整理頁面後再試');
      }

      paddleInstance.Checkout.open({
        customer: { id: data.customerId },
        items: [{ priceId, quantity: 1 }],
        // webhook 優先用 customData.clerkUserId 對應用戶（customer_id 反查為備援）
        customData: data.clerkUserId ? { clerkUserId: data.clerkUserId } : undefined,
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
