import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { StatisticsCrossTable } from '@/features/quiz/StatisticsCrossTable';

export async function generateMetadata() {
  const t = await getTranslations('Statistics');
  return { title: t('title') };
}

export default async function StatisticsPage() {
  const t = await getTranslations('Statistics');
  const { userId } = await auth();
  if (!userId) {
    return notFound();
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/dashboard/quizzes"
          className="text-sm text-gray-500 transition hover:text-gray-700"
        >
          ←
          {' '}
          {t('back')}
        </Link>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
      </div>
      <StatisticsCrossTable />
    </div>
  );
}

export const dynamic = 'force-dynamic';
