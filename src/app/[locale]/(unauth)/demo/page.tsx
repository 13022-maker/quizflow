import { getTranslations, unstable_setRequestLocale } from 'next-intl/server';

import { DemoQuizShowcase } from '@/features/demo/DemoQuizShowcase';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

export async function generateMetadata(props: { params: { locale: string } }) {
  const t = await getTranslations({
    locale: props.params.locale,
    namespace: 'Demo',
  });

  return {
    title: t('meta_title'),
    description: t('meta_description'),
  };
}

// 公開範例頁：不需登入，首頁「看看怎麼用」連到這裡，讓老師先看到成果再決定註冊
const DemoPage = async (props: { params: { locale: string } }) => {
  unstable_setRequestLocale(props.params.locale);
  const t = await getTranslations('Demo');

  return (
    <>
      <Navbar />
      <div className="mx-auto max-w-4xl px-4 pb-8 pt-12 text-center">
        <p className="text-sm font-medium text-primary">{t('eyebrow')}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">{t('description')}</p>
      </div>
      <DemoQuizShowcase />
      <Footer />
    </>
  );
};

export default DemoPage;
