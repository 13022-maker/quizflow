import { eq } from 'drizzle-orm';

import { organizationSchema } from '@/models/Schema';
import { PLAN_ID, PricingPlanList } from '@/utils/AppConfig';

import { db } from './DB';
import { Env } from './Env';

/**
 * 根據 BILLING_PLAN_ENV 取得對應的 Stripe Price ID
 */
function getPriceId(planId: string): string {
  const plan = PricingPlanList[planId];
  if (!plan) {
    return '';
  }
  const env = Env.BILLING_PLAN_ENV;
  if (env === 'prod') {
    return plan.prodPriceId;
  }
  if (env === 'test') {
    return plan.testPriceId;
  }
  return plan.devPriceId;
}

/**
 * 檢查指定 orgId 是否擁有 Pro 或 Enterprise 方案的有效訂閱
 * 開發環境下若 DB 沒有訂閱記錄，視為 Free
 */
export async function getOrgPlanId(orgId: string): Promise<string> {
  const [org] = await db
    .select({
      status: organizationSchema.stripeSubscriptionStatus,
      priceId: organizationSchema.stripeSubscriptionPriceId,
    })
    .from(organizationSchema)
    .where(eq(organizationSchema.id, orgId))
    .limit(1);

  if (!org || org.status !== 'active' || !org.priceId) {
    return PLAN_ID.FREE;
  }

  // 比對 priceId 判斷方案
  const premiumPriceId = getPriceId(PLAN_ID.PREMIUM);
  const enterprisePriceId = getPriceId(PLAN_ID.ENTERPRISE);

  if (org.priceId === enterprisePriceId) {
    return PLAN_ID.ENTERPRISE;
  }
  if (org.priceId === premiumPriceId) {
    return PLAN_ID.PREMIUM;
  }
  return PLAN_ID.FREE;
}

/**
 * 判斷是否為付費方案（Pro 或 Enterprise）
 */
export async function isProOrAbove(orgId: string): Promise<boolean> {
  const planId = await getOrgPlanId(orgId);
  return planId === PLAN_ID.PREMIUM || planId === PLAN_ID.ENTERPRISE;
}
