import type { PLAN_ID } from '@/utils/AppConfig';

import type { EnumValues } from './Enum';

export type PlanId = EnumValues<typeof PLAN_ID>;

export const BILLING_INTERVAL = {
  MONTH: 'month',
  YEAR: 'year',
} as const;

export type BillingInterval = EnumValues<typeof BILLING_INTERVAL>;

// 方案資料結構（Paddle Price ID 改用 env 變數管理，這裡只留顯示 / 配額用欄位）
export type PricingPlan = {
  id: PlanId;
  price: number; // 月繳價（NT$）
  interval: BillingInterval;
  features: {
    teamMember: number;
    website: number; // 測驗數量上限（999 = 無限）
    storage: number;
    transfer: number;
    aiQuota: number; // 每月 AI 出題次數上限（999 = 無限）
    batchQuota?: number; // 每月批次出題題數上限（僅 publisher 方案有；undefined = 不提供批次功能）
  };
};
