import { auth, clerkClient } from '@clerk/nextjs/server';
import { and, count, eq, gte, inArray, sql } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { db } from '@/libs/DB';
import { quizSchema, responseSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

type SearchParams = {
  from?: string;
  to?: string;
  minQuizzes?: string;
  minResponses?: string;
};

export default async function AdminStatsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
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

  // ===== 註冊用戶明細（支援篩選） =====
  type RegisteredUser = {
    id: string;
    name: string;
    email: string;
    initial: string;
    createdAt: number;
    quizCount: number;
    responseCount: number;
  };

  let totalUsers = 0;
  let todayNewUsers = 0;
  let allRegisteredUsers: RegisteredUser[] = [];
  let clerkError = false;

  try {
    const clerk = await clerkClient();
    totalUsers = await clerk.users.getCount();

    // 試用期間：總人數 >= 100 後不再顯示用戶明細，只取最新 100 筆用於「今日新註冊」統計
    const SHOW_USER_DETAILS = totalUsers < 100;
    const PAGE_SIZE = 100;
    const MAX_USERS = SHOW_USER_DETAILS ? 1000 : 100;
    const allUsersRaw: Awaited<ReturnType<typeof clerk.users.getUserList>>['data'] = [];
    for (let offset = 0; offset < MAX_USERS; offset += PAGE_SIZE) {
      const resp = await clerk.users.getUserList({
        orderBy: '-created_at',
        limit: PAGE_SIZE,
        offset,
      });
      allUsersRaw.push(...resp.data);
      if (resp.data.length < PAGE_SIZE) {
        break;
      }
    }

    todayNewUsers = allUsersRaw.filter(u => new Date(u.createdAt) >= today).length;

    // 總人數 >= 100 時跳過明細聚合（節省 Clerk API + DB 查詢），明細區塊不會顯示
    if (SHOW_USER_DETAILS) {
      // 批次抓取每位用戶的 organization memberships（決定其 ownerIds）
      // ownerId = orgId（建立測驗時使用），所以要把用戶所屬的每個 org 都納入
      const membershipResults = await Promise.all(
        allUsersRaw.map(async (u) => {
          try {
            const m = await clerk.users.getOrganizationMembershipList({ userId: u.id });
            return { userId: u.id, orgIds: m.data.map(x => x.organization.id) };
          } catch {
            return { userId: u.id, orgIds: [] as string[] };
          }
        }),
      );

      // 收集所有需要查詢的 ownerId（含用戶自己的 userId，作為相容 fallback）
      const allOwnerIds = new Set<string>();
      for (const { userId, orgIds } of membershipResults) {
        allOwnerIds.add(userId);
        for (const id of orgIds) {
          allOwnerIds.add(id);
        }
      }

      // 以單一 SQL 聚合每個 ownerId 的測驗數與作答數
      const ownerIdsArr = Array.from(allOwnerIds);
      const quizCountMap = new Map<string, number>();
      const responseCountMap = new Map<string, number>();

      if (ownerIdsArr.length > 0) {
        const quizCounts = await db
          .select({ ownerId: quizSchema.ownerId, total: count() })
          .from(quizSchema)
          .where(inArray(quizSchema.ownerId, ownerIdsArr))
          .groupBy(quizSchema.ownerId);

        for (const row of quizCounts) {
          quizCountMap.set(row.ownerId, Number(row.total));
        }

        const responseCounts = await db
          .select({ ownerId: quizSchema.ownerId, total: count() })
          .from(responseSchema)
          .innerJoin(quizSchema, eq(responseSchema.quizId, quizSchema.id))
          .where(inArray(quizSchema.ownerId, ownerIdsArr))
          .groupBy(quizSchema.ownerId);

        for (const row of responseCounts) {
          responseCountMap.set(row.ownerId, Number(row.total));
        }
      }

      // 建立 userId → ownerIds 快表
      const userOwnerIds = new Map<string, string[]>();
      for (const { userId, orgIds } of membershipResults) {
        userOwnerIds.set(userId, [userId, ...orgIds]);
      }

      allRegisteredUsers = allUsersRaw.map((u) => {
        const name = [u.firstName, u.lastName].filter(Boolean).join(' ')
          || u.username
          || u.primaryEmailAddress?.emailAddress?.split('@')[0]
          || '匿名';
        const email = u.primaryEmailAddress?.emailAddress
          || u.emailAddresses?.[0]?.emailAddress
          || '—';
        const ownerIds = userOwnerIds.get(u.id) ?? [u.id];
        let quizCount = 0;
        let responseCount = 0;
        for (const id of ownerIds) {
          quizCount += quizCountMap.get(id) ?? 0;
          responseCount += responseCountMap.get(id) ?? 0;
        }
        return {
          id: u.id,
          name,
          email,
          initial: (name.charAt(0) || '?').toUpperCase(),
          createdAt: u.createdAt,
          quizCount,
          responseCount,
        };
      });
    }
  } catch {
    clerkError = true;
  }

  // ===== 套用篩選條件 =====
  const filterFrom = parseDate(searchParams.from);
  const filterTo = parseDate(searchParams.to);
  const filterMinQuizzes = Number.parseInt(searchParams.minQuizzes ?? '', 10);
  const filterMinResponses = Number.parseInt(searchParams.minResponses ?? '', 10);

  const filteredUsers = allRegisteredUsers.filter((u) => {
    const created = new Date(u.createdAt);
    if (filterFrom && created < filterFrom) {
      return false;
    }
    if (filterTo) {
      // 含當日：to 為當日的 23:59:59
      const toEnd = new Date(filterTo);
      toEnd.setHours(23, 59, 59, 999);
      if (created > toEnd) {
        return false;
      }
    }
    if (Number.isFinite(filterMinQuizzes) && u.quizCount < filterMinQuizzes) {
      return false;
    }
    if (Number.isFinite(filterMinResponses) && u.responseCount < filterMinResponses) {
      return false;
    }
    return true;
  });

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

      {/* 註冊用戶（可篩選）— 試用期間僅在總人數 < 100 時顯示 */}
      {totalUsers < 100 && (
        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">註冊用戶</h2>
            <span className="text-xs text-muted-foreground">
              顯示
              {' '}
              {filteredUsers.length}
              {' '}
              /
              {' '}
              {allRegisteredUsers.length}
              {' '}
              位
            </span>
          </div>

          {/* 篩選表單 */}
          <form method="get" className="mb-4 rounded-xl border bg-card p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">註冊日期（起）</span>
                <input
                  type="date"
                  name="from"
                  defaultValue={searchParams.from ?? ''}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">註冊日期（迄）</span>
                <input
                  type="date"
                  name="to"
                  defaultValue={searchParams.to ?? ''}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">最少考卷數</span>
                <input
                  type="number"
                  name="minQuizzes"
                  min={0}
                  defaultValue={searchParams.minQuizzes ?? ''}
                  placeholder="不限"
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">最少學生作答次數</span>
                <input
                  type="number"
                  name="minResponses"
                  min={0}
                  defaultValue={searchParams.minResponses ?? ''}
                  placeholder="不限"
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                />
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="submit"
                className="h-9 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700"
              >
                套用篩選
              </button>
              <a
                href="?"
                className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted"
              >
                清除
              </a>
            </div>
          </form>

          {clerkError
            ? (
                <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">無法讀取用戶資料</p>
              )
            : filteredUsers.length > 0
              ? (
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">用戶</th>
                          <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Email</th>
                          <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">考卷數</th>
                          <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">作答次數</th>
                          <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">註冊時間</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {filteredUsers.map((u) => {
                          const createdDate = new Date(u.createdAt);
                          const isToday = createdDate >= today;
                          return (
                            <tr key={u.id} className="hover:bg-muted/20">
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
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
                              <td className="px-4 py-3 text-center font-medium">{u.quizCount}</td>
                              <td className="px-4 py-3 text-center font-medium">{u.responseCount}</td>
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
              : <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">沒有符合條件的用戶</p>}
        </section>
      )}
    </div>
  );
}

function parseDate(value?: string): Date | null {
  if (!value) {
    return null;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  d.setHours(0, 0, 0, 0);
  return d;
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border bg-card px-5 py-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 text-3xl font-bold tracking-tight ${accent ?? ''}`}>{value}</p>
    </div>
  );
}
