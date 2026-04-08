import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { buttonVariants } from '@/components/ui/buttonVariants';
import { MessageState } from '@/features/dashboard/MessageState';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { QuizTable } from '@/features/quiz/QuizTable';
import { db } from '@/libs/DB';
import { getOrgPlanId } from '@/libs/Plan';
import { quizSchema } from '@/models/Schema';
import { PricingPlanList } from '@/utils/AppConfig';

export async function generateMetadata(props: { params: { locale: string } }) {
  const t = await getTranslations({
    locale: props.params.locale,
    namespace: 'Quizzes',
  });
  return { title: t('title_bar') };
}

export default async function QuizzesPage() {
  const { orgId } = await auth();
  const t = await getTranslations('Quizzes');

  let quizzes: (typeof quizSchema.$inferSelect)[] = [];
  let quizCount = 0;
  let quizLimit = 999;
  let planId = 'free';

  try {
    if (orgId) {
      // 並行查詢：測驗清單、方案資訊
      [planId, quizzes] = await Promise.all([
        getOrgPlanId(orgId),
        db.select().from(quizSchema).where(eq(quizSchema.ownerId, orgId)).orderBy(quizSchema.createdAt),
      ]);
      quizLimit = PricingPlanList[planId]?.features.website ?? 3;
      quizCount = quizzes.length;
    }
  } catch (err) {
    console.error('[QuizzesPage] DB query failed:', err);
    throw err;
  }

  const isFree = quizLimit < 999;
  const isAtLimit = isFree && quizCount >= quizLimit;

  return (
    <>
      <TitleBar
        title={t('title_bar')}
        description={t('title_bar_description')}
      />

      {/* 工具列：額度指示 + 建立按鈕 */}
      <div className="mb-4 flex items-center justify-between gap-4">
        {/* 免費方案顯示額度 */}
        {isFree && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span>測驗額度：</span>
              <span className={`font-medium ${isAtLimit ? 'text-red-600' : 'text-foreground'}`}>
                {quizCount}
                {' '}
                /
                {' '}
                {quizLimit}
              </span>
            </div>
            {/* 視覺進度條 */}
            <div className="hidden h-2 w-20 overflow-hidden rounded-full bg-muted sm:block">
              <div
                className={`h-full rounded-full transition-all ${isAtLimit ? 'bg-red-500' : 'bg-primary'}`}
                style={{ width: `${Math.min((quizCount / quizLimit) * 100, 100)}%` }}
              />
            </div>
            {isAtLimit && (
              <Link
                href="/dashboard/billing"
                className="text-xs font-medium text-primary hover:underline"
              >
                升級 Pro →
              </Link>
            )}
          </div>
        )}

        {/* 建立按鈕：達上限時顯示 disabled 樣式並引導升級 */}
        {isAtLimit
          ? (
              <Link
                href="/dashboard/billing"
                className={buttonVariants({ size: 'sm', variant: 'outline' })}
                title="免費方案已達測驗上限，請升級 Pro 繼續建立"
              >
                🔒 已達上限 · 升級
              </Link>
            )
          : (
              <Link href="/dashboard/quizzes/new" className={buttonVariants({ size: 'sm' })}>
                {t('add_quiz_button')}
              </Link>
            )}
      </div>

      {/* 測驗列表或空白提示 */}
      {quizzes.length === 0
        ? (
            <MessageState
              icon={(
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M0 0h24v24H0z" stroke="none" />
                  <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              )}
              title={t('empty_title')}
              description={t('empty_description')}
              button={(
                <Link href="/dashboard/quizzes/new" className={buttonVariants()}>
                  {t('empty_button')}
                </Link>
              )}
            />
          )
        : <QuizTable quizzes={quizzes} />}
    </>
  );
}

export const dynamic = 'force-dynamic';
