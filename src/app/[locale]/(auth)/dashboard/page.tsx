import { auth } from '@clerk/nextjs/server';
import type { InferSelectModel } from 'drizzle-orm';
import { and, count, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import Link from 'next/link';

import { CheckoutSuccessBanner } from '@/components/billing/CheckoutSuccessBanner';
import { OnboardingSteps } from '@/components/onboarding/OnboardingSteps';
import { StreakCard } from '@/features/dashboard/StreakCard';
import { TemplateA } from '@/features/dashboard/templates/TemplateA';
import { TemplateB } from '@/features/dashboard/templates/TemplateB';
import { TemplateC } from '@/features/dashboard/templates/TemplateC';
import type { DashboardData } from '@/features/dashboard/templates/types';
import { TrialBanner } from '@/features/dashboard/TrialBanner';
import { db } from '@/libs/DB';
import type { quizSchema as quizSchemaType } from '@/models/Schema';
import { quizSchema, responseSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

type Quiz = InferSelectModel<typeof quizSchemaType>;

export default async function DashboardIndexPage({
  searchParams,
}: {
  searchParams: { t?: string };
}) {
  const { orgId, userId } = await auth();
  const template = searchParams.t ?? 'b';

  let recentQuizzes: Quiz[] = [];
  let totalQuizCount = 0;
  let publishedCount = 0;
  let totalResponses = 0;
  let avgScorePercent: number | null = null;
  let responseCountMap = new Map<number, number>();

  if (orgId) {
    recentQuizzes = await db
      .select()
      .from(quizSchema)
      .where(eq(quizSchema.ownerId, orgId))
      .orderBy(desc(quizSchema.createdAt))
      .limit(6);

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
      status: q.status,
      createdAt: q.createdAt,
      responseCount: responseCountMap.get(q.id) ?? 0,
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
      {userId && (
        <div className="mx-4 mb-4">
          <TrialBanner clerkUserId={userId} orgId={orgId} />
        </div>
      )}

      {/* 連勝卡片 */}
      <div className="mx-4 mb-4">
        <StreakCard />
      </div>

      {/* Template Switcher */}
      <div className="mx-4 mb-4 flex items-center gap-1 rounded-lg bg-muted/50 p-1">
        <TemplateTab href="?t=a" label="A 指揮中心" active={template === 'a'} />
        <TemplateTab href="?t=b" label="B 教學工作台" active={template === 'b'} />
        <TemplateTab href="?t=c" label="C 清爽極簡" active={template === 'c'} />
      </div>

      {hasQuizzes
        ? (
            <>
              {template === 'a' && <TemplateA data={dashboardData} />}
              {template === 'b' && <TemplateB data={dashboardData} />}
              {template === 'c' && <TemplateC data={dashboardData} />}
            </>
          )
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

function TemplateTab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`flex-1 rounded-md px-3 py-2 text-center text-sm font-medium transition-all ${
        active
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </Link>
  );
}
