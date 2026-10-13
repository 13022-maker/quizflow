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

// 頁首使用流程三步驟（白話說明學科、練習、連結三者關係）
const USAGE_STEPS = [
  { title: '選學科', hint: '學科＝知識點＋題目＋補強課文，練習從這裡出題' },
  { title: '建立練習', hint: '建議一個班級、一個單元建一個' },
  { title: '發連結，看進度', hint: '學生免登入作答，儀表板看誰卡在哪' },
] as const;

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
        description="系統依學生答對答錯調整下一題；學生卡住時，AI 補一段說明再讓他重試。"
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

      {/* 使用流程：讓第一次進來的老師知道「學科 → 練習 → 連結」的關係 */}
      <ol aria-label="使用流程" className="mb-6 grid gap-3 sm:grid-cols-3">
        {USAGE_STEPS.map((step, i) => (
          <li key={step.title} className="flex items-start gap-3 rounded-xl border bg-card p-4">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {i + 1}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">{step.title}</div>
              <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{step.hint}</div>
            </div>
          </li>
        ))}
      </ol>

      {/* 建立練習：收合，避免每次進來都要先滑過表單 */}
      <details className="group mb-8 rounded-xl border bg-card p-5 shadow-sm" open={practices.length === 0}>
        <summary className="cursor-pointer list-none rounded-md text-sm font-semibold marker:content-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
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
                    {/* 建立日期 */}
                    <span className="text-xs text-muted-foreground">
                      {formatDate(p.createdAt)}
                      {' 建立'}
                    </span>
                  </div>
                  {/* 狀態提示：依有沒有學生作答，告訴老師下一步做什麼 */}
                  {p.studentCount > 0
                    ? (
                        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-800">
                          <span className="font-semibold">
                            {p.studentCount}
                            {' 位學生作答中。'}
                          </span>
                          到儀表板看誰卡在哪個知識點。
                        </p>
                      )
                    : (
                        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                          <span className="font-semibold">還沒有學生加入。</span>
                          複製連結貼到班群，學生點開就能作答。
                        </p>
                      )}
                  {/* 主按鈕隨狀態切換：0 人 → 複製連結；有人 → 查看進度 */}
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
                    {p.studentCount > 0
                      ? (
                          <>
                            <Link
                              href={`/dashboard/adaptive/${p.id}`}
                              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                            >
                              查看學生進度 →
                            </Link>
                            <CopyLinkButton path={`/adaptive/${p.accessCode}`} />
                            <ShareClassroomButton path={`/adaptive/${p.accessCode}`} title={p.title} />
                          </>
                        )
                      : (
                          <>
                            <CopyLinkButton path={`/adaptive/${p.accessCode}`} variant="primary" />
                            <ShareClassroomButton path={`/adaptive/${p.accessCode}`} title={p.title} />
                          </>
                        )}
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
