import { getTranslations, unstable_setRequestLocale } from 'next-intl/server';

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
      {/* Paddle production 上線前先隱藏定價（NEXT_PUBLIC_PRICING_ENABLED=true 才顯示） */}
      {process.env.NEXT_PUBLIC_PRICING_ENABLED === 'true' && <Pricing />}
      <FAQ />
      <CTA />
      <Footer />
    </>
  );
};

export default IndexPage;
