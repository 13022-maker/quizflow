import { auth } from '@clerk/nextjs/server';
import type { InferSelectModel } from 'drizzle-orm';
import { and, count, desc, eq, isNotNull } from 'drizzle-orm';
import Link from 'next/link';

import { CheckoutSuccessBanner } from '@/components/billing/CheckoutSuccessBanner';
import { OnboardingSteps } from '@/components/onboarding/OnboardingSteps';
import { StreakCard } from '@/features/dashboard/StreakCard';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { TrialBanner } from '@/features/dashboard/TrialBanner';
import { db } from '@/libs/DB';
import type { quizSchema as quizSchemaType } from '@/models/Schema';
import { quizSchema, responseSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

type Quiz = InferSelectModel<typeof quizSchemaType>;

// 狀態文字與顏色對應（用小點點 + 文字，比填色 pill 更低調）
const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  published: '已發佈',
  closed: '已關閉',
};
const STATUS_DOT: Record<string, string> = {
  draft: 'bg-muted-foreground/60',
  published: 'bg-primary',
  closed: 'bg-destructive',
};

export default async function DashboardIndexPage() {
  const { orgId, userId } = await auth();

  let recentQuizzes: Quiz[] = [];
  let totalQuizCount = 0;
  let totalResponses = 0;
  let avgScorePercent: number | null = null;

  if (orgId) {
    // 最近 5 份測驗
    recentQuizzes = await db
      .select()
      .from(quizSchema)
      .where(eq(quizSchema.ownerId, orgId))
      .orderBy(desc(quizSchema.createdAt))
      .limit(5);

    // 測驗總數
    const [countRow] = await db
      .select({ total: count() })
      .from(quizSchema)
      .where(eq(quizSchema.ownerId, orgId));
    totalQuizCount = countRow?.total ?? 0;

    // 學生作答總次數（join quiz 確認是本人的測驗）
    const [respRow] = await db
      .select({ total: count() })
      .from(responseSchema)
      .innerJoin(quizSchema, eq(responseSchema.quizId, quizSchema.id))
      .where(eq(quizSchema.ownerId, orgId));
    totalResponses = respRow?.total ?? 0;

    // 計算平均答對率（只計算有完整分數的作答）
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
  }

  const hasQuizzes = recentQuizzes.length > 0;

  // 右上角「建立新測驗」按鈕，TitleBar 與空狀態共用
  const newQuizButton = (
    <Link
      href="/dashboard/quizzes/new"
      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
    >
      <span className="text-base leading-none">+</span>
      建立新測驗
    </Link>
  );

  return (
    <>
      <TitleBar
        title="後台首頁"
        description="管理你的測驗、追蹤學生作答狀況"
        action={newQuizButton}
      />

      {/* Paddle 結帳成功提示 */}
      <CheckoutSuccessBanner />

      <div className="px-4 pb-8">
        {/* Pro 試用倒數 / 到期提示（已付費用戶不顯示） */}
        {userId && (
          <div className="mb-6">
            <TrialBanner clerkUserId={userId} orgId={orgId} />
          </div>
        )}

        {/* 連勝卡片（所有登入使用者皆顯示） */}
        <div className="mb-6">
          <StreakCard />
        </div>

        {hasQuizzes
          ? (
              <>
                {/* 統計卡片 */}
                <div className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <StatCard label="測驗總數" value={String(totalQuizCount)} />
                  <StatCard label="學生作答次數" value={String(totalResponses)} />
                  <StatCard
                    label="平均答對率"
                    value={avgScorePercent !== null ? `${avgScorePercent}%` : '—'}
                    className="col-span-2 sm:col-span-1"
                  />
                </div>

                {/* 最近的測驗列表 */}
                <section>
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold tracking-tight">最近的測驗</h2>
                    <Link
                      href="/dashboard/quizzes"
                      className="text-sm font-medium text-muted-foreground hover:text-foreground"
                    >
                      查看全部 →
                    </Link>
                  </div>

                  <div className="overflow-hidden rounded-xl border bg-card">
                    <table className="w-full text-sm">
                      <thead className="border-b bg-muted/30">
                        <tr>
                          <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">標題</th>
                          <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">狀態</th>
                          <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {recentQuizzes.map(quiz => (
                          <tr key={quiz.id} className="transition-colors hover:bg-muted/20">
                            <td className="px-5 py-3.5 font-medium text-foreground">{quiz.title}</td>
                            <td className="px-5 py-3.5">
                              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                <span
                                  className={`size-1.5 rounded-full ${STATUS_DOT[quiz.status] ?? 'bg-muted-foreground/60'}`}
                                  aria-hidden="true"
                                />
                                {STATUS_LABEL[quiz.status] ?? quiz.status}
                              </span>
                            </td>
                            <td className="px-5 py-3.5 text-right">
                              <Link
                                href={`/dashboard/quizzes/${quiz.id}/edit`}
                                className="mr-4 text-sm font-medium text-primary hover:underline"
                              >
                                編輯
                              </Link>
                              <Link
                                href={`/dashboard/quizzes/${quiz.id}/results`}
                                className="text-sm font-medium text-muted-foreground hover:text-foreground"
                              >
                                成績
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )
          : (
              // 沒有測驗時：只顯示新手引導（TitleBar 已有建立按鈕）
              <OnboardingSteps />
            )}
      </div>
    </>
  );
}

// 統計數字卡片
function StatCard({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={`rounded-xl border bg-card p-5 ${className ?? ''}`}>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-foreground">{value}</p>
    </div>
  );
}
