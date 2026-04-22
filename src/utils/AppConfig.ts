import type { LocalePrefix } from 'node_modules/next-intl/dist/types/src/routing/types';

import { BILLING_INTERVAL, type PricingPlan } from '@/types/Subscription';

const localePrefix: LocalePrefix = 'as-needed';

export const AppConfig = {
  name: 'QuizFlow',
  locales: [
    { id: 'en', name: 'English' },
    { id: 'zh', name: '繁體中文' },
    { id: 'ja', name: '日本語' },
    { id: 'ko', name: '한국어' },
  ],
  defaultLocale: 'zh',
  localePrefix,
};

export const AllLocales = AppConfig.locales.map(locale => locale.id);

export const PLAN_ID = {
  FREE: 'free',
  PREMIUM: 'premium',
  ENTERPRISE: 'enterprise',
} as const;

export const VIP_EMAILS = new Set([
  'prpispace@gmail.com',
]);

export const PricingPlanList: Record<string, PricingPlan> = {
  [PLAN_ID.FREE]: {
    id: PLAN_ID.FREE,
    price: 0,
    interval: BILLING_INTERVAL.MONTH,
    features: {
      teamMember: 1,
      website: 10, // 最多 10 個測驗
      storage: 0,
      transfer: 0,
      aiQuota: 10, // 免費用戶每月 10 次 AI 出題
    },
  },
  [PLAN_ID.PREMIUM]: {
    id: PLAN_ID.PREMIUM,
    price: 299, // Pro 老師：NT$299/月（年繳 NT$2,490），無限測驗 + AI 出題
    interval: BILLING_INTERVAL.MONTH,
    features: {
      teamMember: 1,
      website: 999, // 無限測驗（用 999 代表無上限）
      storage: 1,
      transfer: 0,
      aiQuota: 999, // Pro 無限 AI 出題
    },
  },
  [PLAN_ID.ENTERPRISE]: {
    id: PLAN_ID.ENTERPRISE,
    price: 1990, // 學校方案：NT$1,990/月（年繳 NT$16,990），最多 30 位老師
    interval: BILLING_INTERVAL.MONTH,
    features: {
      teamMember: 30, // 最多 30 位老師帳號（學校方案）
      website: 999, // 無限測驗
      storage: 10,
      transfer: 0,
      aiQuota: 999, // 學校方案無限 AI 出題
    },
  },
};
