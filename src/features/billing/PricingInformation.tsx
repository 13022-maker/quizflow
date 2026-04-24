import { useTranslations } from 'next-intl';

import { PricingCard } from '@/features/billing/PricingCard';
import { PricingFeature } from '@/features/billing/PricingFeature';
import { PLAN_ID, PricingPlanList } from '@/utils/AppConfig';

export const PricingInformation = (props: {
  buttonList: Record<string, React.ReactNode>;
}) => {
  const t = useTranslations('PricingPlan');

  // 書商方案（publisher）非自助購買，走 sales 流程，不顯示於公開定價頁
  const publicPlans = Object.values(PricingPlanList).filter(plan => plan.id !== PLAN_ID.PUBLISHER);

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-8 md:grid-cols-3">
      {publicPlans.map(plan => (
        <PricingCard
          key={plan.id}
          planId={plan.id}
          price={plan.price}
          interval={plan.interval}
          button={props.buttonList[plan.id]}
        >
          <PricingFeature>
            {t('feature_team_member', {
              number: plan.features.teamMember,
            })}
          </PricingFeature>

          <PricingFeature>
            {t('feature_website', {
              number: plan.features.website,
            })}
          </PricingFeature>

          {/* AI 出題：Free (storage=0) 顯示「Pro 限定」，Pro 以上正常顯示 */}
          {plan.features.storage > 0 && (
            <PricingFeature>
              {t('feature_storage', {
                number: plan.features.storage,
              })}
            </PricingFeature>
          )}

          <PricingFeature>
            {t('feature_transfer')}
          </PricingFeature>

          <PricingFeature>{t('feature_email_support')}</PricingFeature>
        </PricingCard>
      ))}
    </div>
  );
};
