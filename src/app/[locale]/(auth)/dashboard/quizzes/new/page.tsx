import { auth } from '@clerk/nextjs/server';
import { count, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { AiPrefillTrigger } from '@/features/quiz/AiPrefillTrigger';
import { BloomQuizGenerator } from '@/features/quiz/BloomQuizGenerator';
import { QuizLimitWall } from '@/features/quiz/QuizLimitWall';
import { db } from '@/libs/DB';
import { getUserPlanId, isProOrAbove } from '@/libs/Plan';
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

export default async function NewQuizPage({
  searchParams,
}: {
  searchParams: { ai?: string; prefill?: string };
}) {
  const { userId } = await auth();

  // 伺服器端先查方案與測驗數量，超過上限就顯示升級牆
  // 試用中老師走 isProOrAbove 短路，與 quizActions / dashboard quizzes 待遇一致
  if (userId && !(await isProOrAbove(userId))) {
    const planId = await getUserPlanId(userId);
    const quizLimit = PricingPlanList[planId]?.features.website ?? 10;

    if (quizLimit < 999) {
      const [row] = await db
        .select({ total: count() })
        .from(quizSchema)
        .where(eq(quizSchema.ownerId, userId));
      const current = row?.total ?? 0;

      if (current >= quizLimit) {
        return <QuizLimitWall current={current} limit={quizLimit} />;
      }
    }
  }

  // 從市集 CTA 進來：?ai=1 觸發 AI 自動建立測驗 + redirect 到 edit 頁
  if (searchParams.ai === '1') {
    return <AiPrefillTrigger prefill={searchParams.prefill ?? ''} />;
  }

  return <BloomQuizGenerator />;
}
