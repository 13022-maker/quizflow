import { auth } from '@clerk/nextjs/server';
import { count, eq, inArray } from 'drizzle-orm';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { buttonVariants } from '@/components/ui/buttonVariants';
import { MessageState } from '@/features/dashboard/MessageState';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { CreateQuizWithAIButton } from '@/features/quiz/CreateQuizWithAIButton';
import { QuizCardList } from '@/features/quiz/QuizCardList';
import { db } from '@/libs/DB';
import { getOrgPlanId } from '@/libs/Plan';
import { quizSchema, responseSchema } from '@/models/Schema';
import { PricingPlanList } from '@/utils/AppConfig';

export async function generateMetadata(props: { params: { locale: string } }) {
  const t = await getTranslations({
    locale: props.params.locale,
    namespace: 'Quizzes',
  });
  return { title: t('title_bar') };
}

export default async function QuizzesPage() {
  const { userId } = await auth();
  const t = await getTranslations('Quizzes');

  let quizzes: (typeof quizSchema.$inferSelect)[] = [];
  let quizCount = 0;
  let quizLimit = 999;
  let planId = 'free';

  try {
    if (userId) {
      // 並行查詢：測驗清單、方案資訊
      // 明確列出欄位，避免 SELECT * 撈到尚未 migrate 的欄位導致 crash
      [planId, quizzes] = await Promise.all([
        getOrgPlanId(userId),
        db.select({
          id: quizSchema.id,
          ownerId: quizSchema.ownerId,
          title: quizSchema.title,
          description: quizSchema.description,
          accessCode: quizSchema.accessCode,
          status: quizSchema.status,
          shuffleQuestions: quizSchema.shuffleQuestions,
          shuffleOptions: quizSchema.shuffleOptions,
          allowedAttempts: quizSchema.allowedAttempts,
          showAnswers: quizSchema.showAnswers,
          timeLimitSeconds: quizSchema.timeLimitSeconds,
          preventLeave: quizSchema.preventLeave,
          roomCode: quizSchema.roomCode,
          scoringMode: quizSchema.scoringMode,
          attemptDecayRate: quizSchema.attemptDecayRate,
          expiresAt: quizSchema.expiresAt,
          updatedAt: quizSchema.updatedAt,
          createdAt: quizSchema.createdAt,
        }).from(quizSchema).where(eq(quizSchema.ownerId, userId)).orderBy(quizSchema.createdAt) as any,
      ]);
      quizLimit = PricingPlanList[planId]?.features.website ?? 10;
      quizCount = quizzes.length;
    }
  } catch (err) {
    console.error('[QuizzesPage] DB query failed:', err);
    throw err;
  }

  // 每份測驗的作答人數
  let responseCounts = new Map<number, number>();
  if (quizzes.length > 0) {
    const ids = quizzes.map(q => q.id);
    const rows = await db
      .select({ quizId: responseSchema.quizId, total: count() })
      .from(responseSchema)
      .where(inArray(responseSchema.quizId, ids))
      .groupBy(responseSchema.quizId);
    responseCounts = new Map(rows.map(r => [r.quizId, r.total]));
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
              // 主按鈕直達 AI 命題；旁邊加小字「手動建立」副入口連到 /new 頁（手動 / vocab）
              <div className="flex items-center gap-3">
                <Link
                  href="/dashboard/quizzes/new"
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  手動建立 ↗
                </Link>
                <CreateQuizWithAIButton className={buttonVariants({ size: 'sm' })}>
                  {t('add_quiz_button')}
                </CreateQuizWithAIButton>
              </div>
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
                <CreateQuizWithAIButton className={buttonVariants()}>
                  {t('empty_button')}
                </CreateQuizWithAIButton>
              )}
            />
          )
        : <QuizCardList quizzes={quizzes} responseCounts={responseCounts} />}
    </>
  );
}

export const dynamic = 'force-dynamic';
