'use client';

/**
 * PaddleProvider
 * 在 client 端初始化 Paddle.js，掛載在 layout 層讓所有頁面都能呼叫 checkout
 */

import { initializePaddle } from '@paddle/paddle-js';
import { useLocale } from 'next-intl';
import { useEffect } from 'react';

// Paddle 目前支援的 locale，不在此清單內一律 fallback 'en'
// 參考：https://developer.paddle.com/reference/platform/supported-locales
const PADDLE_SUPPORTED_LOCALES = new Set([
  'en',
  'zh',
  'ja',
  'ko',
  'de',
  'es',
  'fr',
  'it',
  'nl',
  'pl',
  'pt',
  'ru',
]);

export function PaddleProvider() {
  const locale = useLocale();

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
    if (!token) {
      return; // 未設定 token 時不初始化（開發中）
    }

    const paddleLocale = PADDLE_SUPPORTED_LOCALES.has(locale) ? locale : 'en';

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
          locale: paddleLocale,
        },
      },
    });
  }, [locale]);

  return null;
}
