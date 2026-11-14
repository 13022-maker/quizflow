import { notFound } from 'next/navigation';
import { getTranslations, unstable_setRequestLocale } from 'next-intl/server';

import { PricingSection } from '@/components/pricing/PricingSection';
import { isPricingEnabled } from '@/libs/paddleConfig';
import { CTA } from '@/templates/CTA';
import { FAQ } from '@/templates/FAQ';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

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

const PricingPage = async (props: { params: { locale: string } }) => {
  // 2026-11 正式收費：預設開啟；NEXT_PUBLIC_PRICING_ENABLED=false 為緊急回滾 kill switch
  if (!isPricingEnabled(process.env.NEXT_PUBLIC_PRICING_ENABLED)) {
    notFound();
  }

  unstable_setRequestLocale(props.params.locale);

  return (
    <>
      <Navbar />
      {/*
        /pricing 是正式定價頁：所有訪客（含未登入）都看得到完整方案與價格。
        Paddle domain approval 要求網站清楚揭露價格；首頁定價區塊仍沿用 getPricingVisibility 漸進揭露。
      */}
      <PricingSection showPaidPlans />
      <FAQ />
      <CTA />
      <Footer />
    </>
  );
};

export default PricingPage;
