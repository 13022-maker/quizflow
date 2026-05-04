import { getTranslations, unstable_setRequestLocale } from 'next-intl/server';

import { PricingSection } from '@/components/pricing/PricingSection';
import { getPricingVisibility } from '@/libs/PricingVisibility';
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
  unstable_setRequestLocale(props.params.locale);
  const { showPaidPlans } = await getPricingVisibility();

  return (
    <>
      <Navbar />
      <PricingSection showPaidPlans={showPaidPlans} />
      <FAQ />
      <CTA />
      <Footer />
    </>
  );
};

export default PricingPage;
