import type { LocalePrefix } from 'node_modules/next-intl/dist/types/src/routing/types';

import { BILLING_INTERVAL, type PricingPlan } from '@/types/Subscription';

const localePrefix: LocalePrefix = 'as-needed';

export const AppConfig = {
  name: 'QuizFlow',
  locales: [
    { id: 'en', name: 'English' },
    { id: 'zh', name: '繁體中文' },
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

export const PricingPlanList: Record<string, PricingPlan> = {
  [PLAN_ID.FREE]: {
    id: PLAN_ID.FREE,
    price: 0,
    interval: BILLING_INTERVAL.MONTH,
    testPriceId: '',
    devPriceId: '',
    prodPriceId: '',
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
    price: 9, // Pro 方案：$9/月，無限測驗 + AI 出題 + 班級管理
    interval: BILLING_INTERVAL.MONTH,
    testPriceId: 'price_premium_test',
    devPriceId: 'price_1PNksvKOp3DEwzQlGOXO7YBK',
    prodPriceId: '',
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
    price: 29, // Enterprise 方案：$29/月，學校帳號 + 多老師 + 數據報表
    interval: BILLING_INTERVAL.MONTH,
    testPriceId: 'price_enterprise_test',
    devPriceId: '',
    prodPriceId: '',
    features: {
      teamMember: 999, // 無限老師帳號
      website: 999, // 無限測驗
      storage: 10,
      transfer: 0,
      aiQuota: 999, // Enterprise 無限 AI 出題
    },
  },
};
