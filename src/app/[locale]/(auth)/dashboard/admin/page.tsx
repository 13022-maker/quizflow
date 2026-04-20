import { auth, clerkClient } from '@clerk/nextjs/server';
import { and, count, eq, gte, sql } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { db } from '@/libs/DB';
import { quizSchema, responseSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

export default async function AdminStatsPage() {
  const { orgId } = await auth();
  if (!orgId) {
    return notFound();
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  weekAgo.setHours(0, 0, 0, 0);

  // 今日作答數
  const [todayResponses] = await db
    .select({ total: count() })
    .from(responseSchema)
    .innerJoin(quizSchema, eq(responseSchema.quizId, quizSchema.id))
    .where(and(eq(quizSchema.ownerId, orgId), gte(responseSchema.submittedAt, today)));

  // 本週作答數
  const [weekResponses] = await db
    .select({ total: count() })
    .from(responseSchema)
    .innerJoin(quizSchema, eq(responseSchema.quizId, quizSchema.id))
    .where(and(eq(quizSchema.ownerId, orgId), gte(responseSchema.submittedAt, weekAgo)));

  // 今日新建測驗
  const [todayQuizzes] = await db
    .select({ total: count() })
    .from(quizSchema)
    .where(and(eq(quizSchema.ownerId, orgId), gte(quizSchema.createdAt, today)));

  // 總測驗數
  const [totalQuizzes] = await db
    .select({ total: count() })
    .from(quizSchema)
    .where(eq(quizSchema.ownerId, orgId));

  // 總作答數
  const [totalResponses] = await db
    .select({ total: count() })
    .from(responseSchema)
    .innerJoin(quizSchema, eq(responseSchema.quizId, quizSchema.id))
    .where(eq(quizSchema.ownerId, orgId));

  // 今日作答的不重複學生數
  const [todayStudents] = await db
    .select({ total: sql<number>`count(distinct ${responseSchema.studentEmail})` })
    .from(responseSchema)
    .innerJoin(quizSchema, eq(responseSchema.quizId, quizSchema.id))
    .where(and(eq(quizSchema.ownerId, orgId), gte(responseSchema.submittedAt, today)));

  // 最近 10 筆作答
  const recentResponses = await db
    .select({
      studentName: responseSchema.studentName,
      studentEmail: responseSchema.studentEmail,
      score: responseSchema.score,
      totalPoints: responseSchema.totalPoints,
      submittedAt: responseSchema.submittedAt,
      quizTitle: quizSchema.title,
    })
    .from(responseSchema)
    .innerJoin(quizSchema, eq(responseSchema.quizId, quizSchema.id))
    .where(eq(quizSchema.ownerId, orgId))
    .orderBy(sql`${responseSchema.submittedAt} desc`)
    .limit(10);

  // Clerk 用戶統計
  type RecentUser = {
    id: string;
    name: string;
    email: string;
    initial: string;
    createdAt: number;
  };
  let totalUsers = 0;
  let todayNewUsers = 0;
  let recentRegisteredUsers: RecentUser[] = [];
  try {
    const clerk = await clerkClient();
    totalUsers = await clerk.users.getCount();
    const usersResp = await clerk.users.getUserList({
      orderBy: '-created_at',
      limit: 100,
    });
    todayNewUsers = usersResp.data.filter(
      u => new Date(u.createdAt) >= today,
    ).length;
    // 整理前 20 位新註冊用戶的明細
    recentRegisteredUsers = usersResp.data.slice(0, 20).map((u) => {
      const name = [u.firstName, u.lastName].filter(Boolean).join(' ')
        || u.username
        || u.primaryEmailAddress?.emailAddress?.split('@')[0]
        || '匿名';
      const email = u.primaryEmailAddress?.emailAddress
        || u.emailAddresses?.[0]?.emailAddress
        || '—';
      return {
        id: u.id,
        name,
        email,
        initial: (name.charAt(0) || '?').toUpperCase(),
        createdAt: u.createdAt,
      };
    });
  } catch {
    // Clerk API 失敗不影響其他數據
  }

  const todayStr = today.toLocaleDateString('zh-TW', { month: 'long', day: 'numeric' });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">管理員統計</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        {todayStr}
        {' '}
        資料總覽
      </p>

      {/* 用戶統計 */}
      <div className="mb-4 grid grid-cols-2 gap-4">
        <StatCard label="註冊總人數" value={String(totalUsers)} accent="text-indigo-600" />
        <StatCard label="今日新註冊" value={String(todayNewUsers)} accent="text-pink-600" />
      </div>

      {/* 統計卡片 */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="今日作答" value={String(todayResponses?.total ?? 0)} accent="text-blue-600" />
        <StatCard label="今日學生數" value={String(todayStudents?.total ?? 0)} accent="text-violet-600" />
        <StatCard label="今日新測驗" value={String(todayQuizzes?.total ?? 0)} accent="text-emerald-600" />
        <StatCard label="本週作答" value={String(weekResponses?.total ?? 0)} accent="text-amber-600" />
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4">
        <StatCard label="測驗總數" value={String(totalQuizzes?.total ?? 0)} accent="text-foreground" />
        <StatCard label="作答總數" value={String(totalResponses?.total ?? 0)} accent="text-foreground" />
      </div>

      {/* 最近作答 */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">最近 10 筆作答</h2>
        {recentResponses.length > 0
          ? (
              <div className="overflow-hidden rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">學生</th>
                      <th className="hidden px-4 py-2.5 text-left font-medium text-muted-foreground sm:table-cell">測驗</th>
                      <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">成績</th>
                      <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">時間</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {recentResponses.map((r, i) => (
                      <tr key={i} className="hover:bg-muted/20">
                        <td className="px-4 py-3">{r.studentName || r.studentEmail || '匿名'}</td>
                        <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">{r.quizTitle}</td>
                        <td className="px-4 py-3 text-center">
                          {r.score !== null && r.totalPoints
                            ? `${Math.round((r.score / r.totalPoints) * 100)}%`
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-muted-foreground">
                          {r.submittedAt.toLocaleString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          : <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">目前尚無作答記錄</p>}
      </section>

      {/* 最近註冊用戶明細（取最近 20 位） */}
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">最近註冊用戶</h2>
        {recentRegisteredUsers.length > 0
          ? (
              <div className="overflow-hidden rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">用戶</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Email</th>
                      <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">註冊時間</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {recentRegisteredUsers.map((u) => {
                      const createdDate = new Date(u.createdAt);
                      const isToday = createdDate >= today;
                      return (
                        <tr key={u.id} className="hover:bg-muted/20">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {/* 用首字字母當頭像，避免圖片載入成本 */}
                              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-pink-400 text-xs font-semibold text-white">
                                {u.initial}
                              </div>
                              <span className="truncate">{u.name}</span>
                              {isToday && (
                                <span className="shrink-0 rounded bg-pink-100 px-1.5 py-0.5 text-xs font-medium text-pink-700">
                                  今日
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="max-w-[220px] truncate px-4 py-3 text-muted-foreground">
                            {u.email}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-muted-foreground">
                            {createdDate.toLocaleString('zh-TW', {
                              month: 'numeric',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          : <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">目前尚無註冊用戶</p>}
      </section>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border bg-card px-5 py-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 text-3xl font-bold tracking-tight ${accent ?? ''}`}>{value}</p>
    </div>
  );
}
