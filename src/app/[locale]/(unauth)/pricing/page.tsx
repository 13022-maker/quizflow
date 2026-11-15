import { notFound } from 'next/navigation';
import { getTranslations, unstable_setRequestLocale } from 'next-intl/server';

import { PricingSection } from '@/components/pricing/PricingSection';
import { isPricingEnabled } from '@/libs/paddleConfig';
import { CTA } from '@/templates/CTA';
import { FAQ } from '@/templates/FAQ';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';
import { PLAN_ID, PricingPlanList } from '@/utils/AppConfig';

// 避免 ISR 把單一用戶結果靜態快取給所有訪客
export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: { locale: string } }) {
  const t = await getTranslations({
    locale: props.params.locale,
    namespace: 'PricingPage',
  });

  return {
    title: t('meta_title'),
    description: t('meta_description'),
  };
}

const PricingPage = async (props: {
  params: { locale: string };
  searchParams?: { reason?: string };
}) => {
  // 2026-11 正式收費：預設開啟；NEXT_PUBLIC_PRICING_ENABLED=false 為緊急回滾 kill switch
  if (!isPricingEnabled(process.env.NEXT_PUBLIC_PRICING_ENABLED)) {
    notFound();
  }

  unstable_setRequestLocale(props.params.locale);
  const t = await getTranslations('PricingPage');
  // 從「每日建立測驗上限」導過來時，頂部提示原因（quizQuota.DAILY_QUIZ_LIMIT_PRICING_PATH）
  const fromDailyLimit = props.searchParams?.reason === 'daily_quiz_limit';

  return (
    <>
      <Navbar />
      {/*
        /pricing 是正式定價頁：所有訪客（含未登入）都看得到完整方案與價格。
        Paddle domain approval 要求網站清楚揭露價格；首頁定價區塊仍沿用 getPricingVisibility 漸進揭露。
      */}
      {fromDailyLimit && (
        <div className="mx-auto mt-6 max-w-3xl px-4">
          <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {t('daily_limit_notice', { limit: PricingPlanList[PLAN_ID.FREE]!.features.dailyQuizLimit ?? 5 })}
          </div>
        </div>
      )}
      <PricingSection showPaidPlans />
      <FAQ />
      <CTA />
      <Footer />
    </>
  );
};

export default PricingPage;
