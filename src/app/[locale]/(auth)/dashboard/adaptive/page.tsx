import { auth } from '@clerk/nextjs/server';
import { desc, eq, sql } from 'drizzle-orm';
import Link from 'next/link';

import { createAdaptivePractice, listAvailableSubjects } from '@/actions/adaptiveActions';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { db } from '@/libs/DB';
import { adaptivePracticeSchema, adaptiveStudentStateSchema } from '@/models/Schema';

import { AdaptiveListControls } from './AdaptiveListControls';
import { CopyLinkButton } from './CopyLinkButton';
import { ShareClassroomButton } from './ShareClassroomButton';
import { SubjectCombobox } from './SubjectCombobox';

const SORT_OPTIONS = ['created_desc', 'created_asc', 'title_asc', 'students_desc'] as const;
type SortOption = typeof SORT_OPTIONS[number];

export const dynamic = 'force-dynamic';

// 建立日期顯示格式：M/D
function formatDate(d: Date) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 適性學習 — 練習清單＋建立
 * 老師選學科建立「適性練習」→ 發分享連結給學生（免登入作答）→ 點進去看全班儀表板。
 */
export default async function AdaptiveListPage({
  searchParams,
}: {
  searchParams: { sort?: string; subject?: string };
}) {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }

  const subjects = await listAvailableSubjects(); // 內建三科 ＋ 老師自建學科
  const subjectNames = new Map(subjects.map(s => [s.id, s.name]));
  const builtInSubjects = subjects.filter(s => s.group === 'built-in');
  const customSubjects = subjects.filter(s => s.group === 'custom');

  // 練習清單＋各練習的學生數（未套篩選排序前的全部資料，SQL orderBy 只是穩定的預設順序）
  const allPractices = await db
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

  // 學科篩選（?subject=xxx，未指定或空字串＝全部）
  const filtered = searchParams.subject
    ? allPractices.filter(p => p.subjectId === searchParams.subject)
    : allPractices;

  // 排序（?sort=，白名單 fallback 到預設「建立時間新到舊」，未知值視為未指定）
  const sort: SortOption = SORT_OPTIONS.includes(searchParams.sort as SortOption)
    ? (searchParams.sort as SortOption)
    : 'created_desc';
  const practices = [...filtered].sort((a, b) => {
    switch (sort) {
      case 'created_asc':
        return a.createdAt.getTime() - b.createdAt.getTime();
      case 'title_asc':
        return a.title.localeCompare(b.title, 'zh-Hant');
      case 'students_desc':
        return b.studentCount - a.studentCount;
      default:
        return b.createdAt.getTime() - a.createdAt.getTime();
    }
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <TitleBar
        title="🎯 適性學習"
        description="動態診斷派題＋卡關 AI 補強課文——建立練習後把連結發給學生，免登入即可開始。"
        action={(
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link
              href="/dashboard/adaptive/subjects"
              className="rounded-lg border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
            >
              ⚙️ 管理學科
            </Link>
            <Link
              href="/dashboard/adaptive/new-subject"
              className="rounded-lg bg-primary/10 px-3.5 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20"
            >
              ✨ AI 生成學科
            </Link>
          </div>
        )}
      />

      {/* 建立練習：收合，避免每次進來都要先滑過表單 */}
      <details className="group mb-8 rounded-xl border bg-card p-5 shadow-sm" open={practices.length === 0}>
        <summary className="cursor-pointer list-none text-sm font-semibold marker:content-none">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block transition-transform group-open:rotate-90">▶</span>
            ＋ 建立新練習
          </span>
        </summary>
        <form
          action={createAdaptivePractice}
          className="mt-3 flex flex-wrap items-end gap-3"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="adaptive-title" className="text-sm font-medium">練習名稱</label>
            <input
              id="adaptive-title"
              name="title"
              required
              maxLength={100}
              placeholder="例如：一年甲班 迴圈練習"
              className="h-9 w-56 rounded-lg border px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <SubjectCombobox builtInSubjects={builtInSubjects} customSubjects={customSubjects} />
          <button
            type="submit"
            className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            ＋ 建立練習
          </button>
        </form>
      </details>

      {/* 練習清單：篩選排序控制項，只在原本就有練習時顯示（避免空清單也放一排沒用的下拉選單） */}
      {allPractices.length > 0 && (
        <div className="mb-4 flex justify-end">
          <AdaptiveListControls subjects={subjects.map(s => ({ id: s.id, name: s.name }))} />
        </div>
      )}

      {practices.length > 0
        ? (
            <div className="mb-8 grid gap-4 sm:grid-cols-2">
              {practices.map(p => (
                <div
                  key={p.id}
                  className="group rounded-xl border bg-card p-5 shadow-sm transition-all hover:shadow-md"
                >
                  <Link
                    href={`/dashboard/adaptive/${p.id}`}
                    className="block border-l-[3px] border-primary/70 pl-3"
                  >
                    <span className="text-lg font-bold leading-snug tracking-tight text-foreground transition-colors group-hover:text-primary">
                      {p.title}
                    </span>
                  </Link>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {/* 學科 pill */}
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                      {subjectNames.get(p.subjectId) ?? p.subjectId}
                    </span>
                    {/* 學生數 pill（dot＋label，有學生亮綠、0 位灰） */}
                    <span
                      className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        p.studentCount > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-50 text-gray-500'
                      }`}
                    >
                      <span
                        className={`size-1.5 rounded-full ${
                          p.studentCount > 0 ? 'bg-emerald-500' : 'bg-gray-400'
                        }`}
                      />
                      {p.studentCount}
                      {' 位學生'}
                    </span>
                    {/* 建立日期 */}
                    <span className="text-xs text-muted-foreground">
                      {formatDate(p.createdAt)}
                      {' 建立'}
                    </span>
                  </div>
                  <div className="mt-4 flex items-center gap-2 border-t pt-3">
                    <CopyLinkButton path={`/adaptive/${p.accessCode}`} />
                    <ShareClassroomButton path={`/adaptive/${p.accessCode}`} title={p.title} />
                    <Link
                      href={`/dashboard/adaptive/${p.id}`}
                      className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                    >
                      班級儀表板 →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )
        : (
            <div className="mb-8 rounded-xl border-2 border-dashed py-16 text-center text-muted-foreground">
              <div className="mb-3 text-4xl">🎯</div>
              <p className="text-sm">
                {allPractices.length === 0
                  ? '還沒有練習——用上面的表單建立第一個吧。'
                  : '沒有符合篩選條件的練習。'}
              </p>
            </div>
          )}
    </div>
  );
}
