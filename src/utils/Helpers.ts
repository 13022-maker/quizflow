import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { AppConfig } from './AppConfig';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const MILLISECONDS_IN_ONE_DAY = 86_400_000;

/**
 * SEO / canonical URL 用(robots / sitemap / OG metadata)
 *
 * 原條件 `VERCEL_ENV === 'production'` 在 sitemap ISR build-time 跑時
 * VERCEL_ENV 可能是 build env,導致 fallback 到 internal VERCEL_URL
 * (sitemap.xml 顯示 quizflow-fnvkleagu-... 而非 quizflow-psi)。
 *
 * 拿掉條件:VERCEL_PROJECT_PRODUCTION_URL 在 preview deploy 也會被 Vercel inject
 * (指向 production),對 SEO/canonical 用途來說正確 — preview 不該被索引,
 * canonical 應一律指 production。
 */
export const getBaseUrl = () => {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }

  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return 'http://localhost:3000';
};

export const getI18nPath = (url: string, locale: string) => {
  if (locale === AppConfig.defaultLocale) {
    return url;
  }

  return `/${locale}${url}`;
};
