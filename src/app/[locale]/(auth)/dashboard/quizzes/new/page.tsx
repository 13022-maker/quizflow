import { auth } from '@clerk/nextjs/server';
import { count, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { QuizForm } from '@/features/quiz/QuizForm';
import { QuizLimitWall } from '@/features/quiz/QuizLimitWall';
import { db } from '@/libs/DB';
import { getOrgPlanId } from '@/libs/Plan';
import { quizSchema } from '@/models/Schema';
import { PricingPlanList } from '@/utils/AppConfig';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: { locale: string } }) {
  const t = await getTranslations({
    locale: props.params.locale,
    namespace: 'AddQuiz',
  });
  return { title: t('title_bar') };
}

export default async function NewQuizPage() {
  const t = await getTranslations('AddQuiz');
  const { orgId } = await auth();

  // 伺服器端先查方案與測驗數量，超過上限就顯示升級牆
  if (orgId) {
    const planId = await getOrgPlanId(orgId);
    const quizLimit = PricingPlanList[planId]?.features.website ?? 3;

    if (quizLimit < 999) {
      const [row] = await db
        .select({ total: count() })
        .from(quizSchema)
        .where(eq(quizSchema.ownerId, orgId));
      const current = row?.total ?? 0;

      if (current >= quizLimit) {
        return <QuizLimitWall current={current} limit={quizLimit} />;
      }
    }
  }

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
