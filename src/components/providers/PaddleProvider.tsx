'use client';

/**
 * PaddleProvider
 * 在 client 端初始化 Paddle.js，掛載在 layout 層讓所有頁面都能呼叫 checkout
 */

import { initializePaddle } from '@paddle/paddle-js';
import { useEffect } from 'react';

export function PaddleProvider() {
  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
    const env = process.env.NEXT_PUBLIC_PADDLE_ENV;

    console.log('[Paddle] init params:', {
      tokenPrefix: token ? `${token.slice(0, 12)}...` : 'MISSING',
      environment: env,
      priceIds: {
        proMonthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO_MONTHLY,
        proYearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO_YEARLY,
        teamMonthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_TEAM_MONTHLY,
        teamYearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_TEAM_YEARLY,
      },
    });

    if (!token) {
      console.error('[Paddle] NEXT_PUBLIC_PADDLE_CLIENT_TOKEN 未設定');
      return;
    }

    initializePaddle({
      token,
      environment: env === 'production' ? 'production' : 'sandbox',
      checkout: {
        settings: {
          displayMode: 'overlay',
          theme: 'light',
          locale: 'zh',
        },
      },
    })
      .then(() => console.log('[Paddle] initialized OK'))
      .catch(err => console.error('[Paddle] init failed:', err));
  }, []);

  return null;
}
