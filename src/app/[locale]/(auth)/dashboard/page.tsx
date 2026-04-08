import { auth } from '@clerk/nextjs/server';
import type { InferSelectModel } from 'drizzle-orm';
import { and, count, desc, eq, isNotNull } from 'drizzle-orm';
import Link from 'next/link';

import { OnboardingSteps } from '@/components/onboarding/OnboardingSteps';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { db } from '@/libs/DB';
import type { quizSchema as quizSchemaType } from '@/models/Schema';
import { quizSchema, responseSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

type Quiz = InferSelectModel<typeof quizSchemaType>;

// 狀態文字與顏色對應
const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  published: '已發佈',
  closed: '已關閉',
};
const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  published: 'bg-green-100 text-green-700',
  closed: 'bg-red-100 text-red-700',
};

export default async function DashboardIndexPage() {
  const { orgId } = await auth();

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

  return (
    <>
      <TitleBar
        title="後台首頁"
        description="歡迎使用 QuizFlow"
      />

      <div className="px-4 pb-8">
        {hasQuizzes
          ? (
              <>
                {/* 統計卡片 */}
                <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
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
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-lg font-semibold">最近的測驗</h2>
                    <Link
                      href="/dashboard/quizzes/new"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      + 建立新測驗
                    </Link>
                  </div>

                  <div className="overflow-hidden rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium text-muted-foreground">標題</th>
                          <th className="px-4 py-2 text-left font-medium text-muted-foreground">狀態</th>
                          <th className="px-4 py-2 text-right font-medium text-muted-foreground">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {recentQuizzes.map(quiz => (
                          <tr key={quiz.id} className="hover:bg-muted/30">
                            <td className="px-4 py-3 font-medium">{quiz.title}</td>
                            <td className="px-4 py-3">
                              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[quiz.status] ?? ''}`}>
                                {STATUS_LABEL[quiz.status] ?? quiz.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Link
                                href={`/dashboard/quizzes/${quiz.id}/edit`}
                                className="mr-3 text-primary hover:underline"
                              >
                                編輯
                              </Link>
                              <Link
                                href={`/dashboard/quizzes/${quiz.id}/results`}
                                className="text-muted-foreground hover:underline"
                              >
                                成績
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-3 text-right">
                    <Link href="/dashboard/quizzes" className="text-sm text-primary hover:underline">
                      查看全部測驗 →
                    </Link>
                  </div>
                </section>
              </>
            )
          : (
              // 沒有測驗時：顯示建立按鈕 + 新手引導
              <div>
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
      </div>
    </>
  );
}

// 統計數字卡片
function StatCard({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={`rounded-lg border bg-card px-5 py-4 ${className ?? ''}`}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
    </div>
  );
}
