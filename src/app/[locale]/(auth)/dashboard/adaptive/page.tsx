import { auth } from '@clerk/nextjs/server';
import { desc, eq, sql } from 'drizzle-orm';
import Link from 'next/link';

import { createAdaptivePractice, listAvailableSubjects } from '@/actions/adaptiveActions';
import { db } from '@/libs/DB';
import { adaptivePracticeSchema, adaptiveStudentStateSchema } from '@/models/Schema';

import { CopyLinkButton } from './CopyLinkButton';

export const dynamic = 'force-dynamic';

/**
 * 適性學習 — 練習清單＋建立
 * 老師選學科建立「適性練習」→ 發分享連結給學生（免登入作答）→ 點進去看全班儀表板。
 */
export default async function AdaptiveListPage() {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }

  const subjects = await listAvailableSubjects(); // 內建三科 ＋ 老師自建學科
  const subjectNames = new Map(subjects.map(s => [s.id, s.name]));

  // 練習清單＋各練習的學生數
  const practices = await db
    .select({
      id: adaptivePracticeSchema.id,
      title: adaptivePracticeSchema.title,
      subjectId: adaptivePracticeSchema.subjectId,
      accessCode: adaptivePracticeSchema.accessCode,
      createdAt: adaptivePracticeSchema.createdAt,
      studentCount: sql<number>`COUNT(${adaptiveStudentStateSchema.id})::int`,
    })
    .from(adaptivePracticeSchema)
    .leftJoin(
      adaptiveStudentStateSchema,
      eq(adaptiveStudentStateSchema.practiceId, adaptivePracticeSchema.id),
    )
    .where(eq(adaptivePracticeSchema.ownerId, userId))
    .groupBy(adaptivePracticeSchema.id)
    .orderBy(desc(adaptivePracticeSchema.createdAt));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">🎯 適性學習</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            BKT 動態診斷派題＋卡關 AI 補強課文——建立練習後把連結發給學生，免登入即可開始。
          </p>
        </div>
        <Link
          href="/dashboard/adaptive/new-subject"
          className="shrink-0 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          ✨ AI 生成學科
        </Link>
      </div>

      {/* 建立練習 */}
      <form
        action={createAdaptivePractice}
        className="mb-8 mt-4 flex flex-wrap items-end gap-3 rounded-lg border p-4"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="adaptive-title" className="text-sm font-medium">練習名稱</label>
          <input
            id="adaptive-title"
            name="title"
            required
            maxLength={100}
            placeholder="例如：一年甲班 迴圈練習"
            className="h-9 w-56 rounded-md border px-3 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="adaptive-subject" className="text-sm font-medium">學科</label>
          <select
            id="adaptive-subject"
            name="subjectId"
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            {subjects.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          ＋ 建立練習
        </button>
      </form>

      {/* 練習清單 */}
      {practices.length > 0
        ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {practices.map(p => (
                <div key={p.id} className="rounded-lg border p-4">
                  <Link
                    href={`/dashboard/adaptive/${p.id}`}
                    className="font-medium hover:underline"
                  >
                    {p.title}
                  </Link>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {subjectNames.get(p.subjectId) ?? p.subjectId}
                    {' · '}
                    {p.studentCount}
                    {' 位學生'}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <CopyLinkButton path={`/adaptive/${p.accessCode}`} />
                    <Link
                      href={`/dashboard/adaptive/${p.id}`}
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      班級儀表板 →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )
        : (
            <p className="text-sm text-muted-foreground">
              還沒有練習——用上面的表單建立第一個吧。
            </p>
          )}
    </div>
  );
}
