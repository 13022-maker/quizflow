import { getTranslations } from 'next-intl/server';

import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { QuizForm } from '@/features/quiz/QuizForm';

export async function generateMetadata(props: { params: { locale: string } }) {
  const t = await getTranslations({
    locale: props.params.locale,
    namespace: 'AddQuiz',
  });
  return { title: t('title_bar') };
}

export default async function NewQuizPage() {
  const t = await getTranslations('AddQuiz');

  return (
    <>
      <TitleBar title={t('title_bar')} />

      <DashboardSection
        title={t('section_title')}
        description={t('section_description')}
      >
        <QuizForm />
      </DashboardSection>
    </>
  );
}
