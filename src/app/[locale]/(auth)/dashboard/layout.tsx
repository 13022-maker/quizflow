import { auth } from '@clerk/nextjs/server';
import { getTranslations } from 'next-intl/server';

import { InAppBrowserBanner } from '@/components/InAppBrowserBanner';
import { DashboardHeader } from '@/features/dashboard/DashboardHeader';
import { ensureTrialRecord } from '@/libs/trial';

export async function generateMetadata(props: { params: { locale: string } }) {
  const t = await getTranslations({
    locale: props.params.locale,
    namespace: 'Dashboard',
  });

  return {
    title: t('meta_title'),
    description: t('meta_description'),
  };
}

export default async function DashboardLayout(props: { children: React.ReactNode }) {
  const t = await getTranslations('DashboardLayout');

  // 進入 dashboard 即起算 30 天 Pro 試用（idempotent，第 2 次以後純 SELECT）
  const { userId } = await auth();
  if (userId) {
    await ensureTrialRecord(userId);
  }

  return (
    <>
      <div className="shadow-md">
        <div className="mx-auto flex max-w-screen-xl items-center justify-between px-3 py-4">
          <DashboardHeader
            menu={[
              {
                href: '/dashboard',
                label: t('home'),
              },
              {
                href: '/dashboard/quizzes',
                label: t('quizzes'),
              },
              {
                href: '/dashboard/vocab',
                label: '單字卡',
              },
              {
                href: '/marketplace',
                label: '市集',
              },
            ]}
          />
        </div>
      </div>

      <div className="min-h-[calc(100vh-72px)] bg-muted">
        <div className="mx-auto max-w-screen-xl px-3 pb-16 pt-6">
          <InAppBrowserBanner />
          {props.children}
        </div>
      </div>
    </>
  );
}

export const dynamic = 'force-dynamic';
