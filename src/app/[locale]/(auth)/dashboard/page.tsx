import { auth } from '@clerk/nextjs/server';
import { and, count, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import Link from 'next/link';

import { CheckoutSuccessBanner } from '@/components/billing/CheckoutSuccessBanner';
import { OnboardingSteps } from '@/components/onboarding/OnboardingSteps';
import { StreakCard } from '@/features/dashboard/StreakCard';
import { TemplateB } from '@/features/dashboard/templates/TemplateB';
import type { DashboardData } from '@/features/dashboard/templates/types';
import { TrialBanner } from '@/features/dashboard/TrialBanner';
import { db } from '@/libs/DB';
import { quizSchema, responseSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

type DashboardQuiz = {
  id: number;
  title: string;
  description: string | null;
  status: string;
  createdAt: Date;
  accessCode: string | null;
  quizMode: string;
};

export default async function DashboardIndexPage() {
  const { orgId, userId } = await auth();

  let recentQuizzes: DashboardQuiz[] = [];
  let totalQuizCount = 0;
  let publishedCount = 0;
  let totalResponses = 0;
  let avgScorePercent: number | null = null;
  let responseCountMap = new Map<number, number>();

  if (orgId) {
    recentQuizzes = await db
      .select({
        id: quizSchema.id,
        title: quizSchema.title,
        description: quizSchema.description,
        status: quizSchema.status,
        createdAt: quizSchema.createdAt,
        accessCode: quizSchema.accessCode,
        quizMode: quizSchema.quizMode,
      })
      .from(quizSchema)
      .where(eq(quizSchema.ownerId, orgId))
      .orderBy(desc(quizSchema.createdAt))
      .limit(18);

    const [countRow] = await db
      .select({ total: count() })
      .from(quizSchema)
      .where(eq(quizSchema.ownerId, orgId));
    totalQuizCount = countRow?.total ?? 0;

    const [pubRow] = await db
      .select({ total: count() })
      .from(quizSchema)
      .where(and(eq(quizSchema.ownerId, orgId), eq(quizSchema.status, 'published')));
    publishedCount = pubRow?.total ?? 0;

    const [respRow] = await db
      .select({ total: count() })
      .from(responseSchema)
      .innerJoin(quizSchema, eq(responseSchema.quizId, quizSchema.id))
      .where(eq(quizSchema.ownerId, orgId));
    totalResponses = respRow?.total ?? 0;

    const scoredData = await db
      .select({ score: responseSchema.score, totalPoints: responseSchema.totalPoints })
      .from(responseSchema)
      .innerJoin(quizSchema, eq(responseSchema.quizId, quizSchema.id))
      .where(
        and(
          eq(quizSchema.ownerId, orgId),
          isNotNull(responseSchema.score),
          isNotNull(responseSchema.totalPoints),
        ),
      );

    const valid = scoredData.filter(r => r.totalPoints && r.totalPoints > 0);
    if (valid.length > 0) {
      avgScorePercent = Math.round(
        valid.reduce((sum, r) => sum + (r.score! / r.totalPoints!) * 100, 0) / valid.length,
      );
    }

    const quizIds = recentQuizzes.map(q => q.id);
    if (quizIds.length > 0) {
      const rcRows = await db
        .select({ quizId: responseSchema.quizId, total: count() })
        .from(responseSchema)
        .where(inArray(responseSchema.quizId, quizIds))
        .groupBy(responseSchema.quizId);
      responseCountMap = new Map(rcRows.map(r => [r.quizId, r.total]));
    }
  }

  const hasQuizzes = recentQuizzes.length > 0;

  const dashboardData: DashboardData = {
    recentQuizzes: recentQuizzes.map(q => ({
      id: q.id,
      title: q.title,
      description: q.description,
      status: q.status,
      createdAt: q.createdAt,
      responseCount: responseCountMap.get(q.id) ?? 0,
      accessCode: q.accessCode ?? '',
      quizMode: q.quizMode,
    })),
    totalQuizCount,
    publishedCount,
    totalResponses,
    avgScorePercent,
  };

  return (
    <>
      <CheckoutSuccessBanner />

      {/* Pro 試用倒數 / 到期提示 */}
      {userId && orgId && (
        <div className="mx-4 mb-4">
          <TrialBanner clerkUserId={userId} orgId={orgId} />
        </div>
      )}

      {/* 連勝卡片 */}
      <div className="mx-4 mb-4">
        <StreakCard totalResponses={totalResponses} />
      </div>

      {hasQuizzes
        ? <TemplateB data={dashboardData} />
        : (
            <div className="px-4 pb-8">
              <div className="mb-6 flex justify-end">
                <Link
                  href="/dashboard/quizzes/new"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  + 建立新測驗
                </Link>
              </div>
              <OnboardingSteps />
            </div>
          )}
    </>
  );
}
