import { getTranslations, unstable_setRequestLocale } from 'next-intl/server';

import { isPricingEnabled } from '@/libs/paddleConfig';
import { CTA } from '@/templates/CTA';
import { DemoBanner } from '@/templates/DemoBanner';
import { FAQ } from '@/templates/FAQ';
import { Features } from '@/templates/Features';
import { Footer } from '@/templates/Footer';
import { Hero } from '@/templates/Hero';
import { Navbar } from '@/templates/Navbar';
import { Pricing } from '@/templates/Pricing';

export async function generateMetadata(props: { params: { locale: string } }) {
  const t = await getTranslations({
    locale: props.params.locale,
    namespace: 'Index',
  });

  return {
    title: t('meta_title'),
    description: t('meta_description'),
  };
}

const IndexPage = (props: { params: { locale: string } }) => {
  unstable_setRequestLocale(props.params.locale);

  return (
    <>
      <DemoBanner />
      <Navbar />
      <Hero />
      <Features />
      {/* 2026-11 正式收費：定價區塊常態顯示；NEXT_PUBLIC_PRICING_ENABLED=false 可緊急隱藏 */}
      {isPricingEnabled(process.env.NEXT_PUBLIC_PRICING_ENABLED) && <Pricing />}
      <FAQ />
      <CTA />
      <Footer />
    </>
  );
};

export default IndexPage;
