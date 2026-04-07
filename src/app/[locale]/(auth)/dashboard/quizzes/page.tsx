import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { buttonVariants } from '@/components/ui/buttonVariants';
import { MessageState } from '@/features/dashboard/MessageState';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { QuizTable } from '@/features/quiz/QuizTable';
import { db } from '@/libs/DB';
import { quizSchema } from '@/models/Schema';

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
  try {
    quizzes = orgId
      ? await db
        .select()
        .from(quizSchema)
        .where(eq(quizSchema.ownerId, orgId))
        .orderBy(quizSchema.createdAt)
      : [];
  } catch (err) {
    // 將完整錯誤印到 Vercel Runtime log，方便排查
    console.error('[QuizzesPage] DB query failed:', err);
    throw err;
  }

  return (
    <>
      <TitleBar
        title={t('title_bar')}
        description={t('title_bar_description')}
      />

      <div className="mb-4 flex justify-end">
        <Link href="/dashboard/quizzes/new" className={buttonVariants({ size: 'sm' })}>
          {t('add_quiz_button')}
        </Link>
      </div>

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
