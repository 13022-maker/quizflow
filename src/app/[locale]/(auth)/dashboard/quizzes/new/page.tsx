import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { AiPrefillTrigger } from '@/features/quiz/AiPrefillTrigger';
import { BloomQuizGenerator } from '@/features/quiz/BloomQuizGenerator';
import { DAILY_QUIZ_LIMIT_PRICING_PATH } from '@/libs/quizQuota';
import { getDailyQuizQuota } from '@/libs/quizQuota-dao';

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

  // 試用結束後的 Free 每天最多建立 5 份，超過直接導向定價頁
  // VIP / Pro / 試用中由 getDailyQuizQuota 判定為不限，與 quizActions.createQuiz 一致
  if (userId && (await getDailyQuizQuota(userId)).exceeded) {
    redirect(DAILY_QUIZ_LIMIT_PRICING_PATH);
  }

  // 從市集 CTA 進來：?ai=1 觸發 AI 自動建立測驗 + redirect 到 edit 頁
  if (searchParams.ai === '1') {
    return <AiPrefillTrigger prefill={searchParams.prefill ?? ''} />;
  }

  return <BloomQuizGenerator />;
}
