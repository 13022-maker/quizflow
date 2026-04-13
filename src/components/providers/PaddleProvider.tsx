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
    if (!token) {
      return; // 未設定 token 時不初始化（開發中）
    }

    initializePaddle({
      token,
      environment:
        process.env.NEXT_PUBLIC_PADDLE_ENV === 'production'
          ? 'production'
          : 'sandbox',
      checkout: {
        settings: {
          displayMode: 'overlay',
          theme: 'light',
          locale: 'zh',
        },
      },
    });
  }, []);

  return null;
}
