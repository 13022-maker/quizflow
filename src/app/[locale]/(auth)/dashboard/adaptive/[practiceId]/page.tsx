import { auth } from '@clerk/nextjs/server';
import { and, desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  filterActiveStudentKeys,
  lastMonthRangeInTaipei,
  mondayInTaipei,
  monthStartInTaipei,
  parseDateRangeParams,
  todayInTaipei,
} from '@/libs/adaptive/dateRangeFilter';
import type { KnowledgeDiagnosis } from '@/libs/adaptive/engine';
import { getAdaptiveService } from '@/libs/adaptive/service';
import { db } from '@/libs/DB';
import { adaptiveEventSchema, adaptivePracticeSchema, adaptiveStudentStateSchema } from '@/models/Schema';

import { AutoRefresh } from '../AutoRefresh';
import { CopyLinkButton } from '../CopyLinkButton';
import { DeletePracticeButton } from './DeleteButton';

export const dynamic = 'force-dynamic';

/** 事件類型 → 圖示與中文標籤（時間軸） */
const EVENT_META: Record<string, { icon: string; label: string }> = {
  remedial_lesson_dispatched: { icon: '📖', label: '觸發補強課文' },
  annotation_added: { icon: '✏️', label: '劃線提問' },
  lesson_completed: { icon: '✅', label: '讀完課文' },
  knowledge_mastered: { icon: '🏆', label: '達成精熟' },
  course_completed: { icon: '🎓', label: '完成課程' },
};

const STATUS_META = {
  mastered: { label: '✅ 已精熟', bar: 'bg-green-500' },
  learning: { label: '📖 學習中', bar: 'bg-blue-500' },
  locked: { label: '🔒 鎖定中', bar: 'bg-gray-400' },
} as const;

/**
 * 適性練習 — 班級儀表板
 * 全班 × 知識點精熟度總覽（重用引擎的診斷邏輯）＋學習日誌時間軸，10 秒自動刷新。
 */
export default async function AdaptiveBoardPage({
  params,
  searchParams,
}: {
  params: { practiceId: string };
  searchParams: { sort?: string; start?: string; end?: string };
}) {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }

  const practiceId = Number(params.practiceId);
  if (!Number.isInteger(practiceId)) {
    notFound();
  }

  // 只能看自己的練習
  const [practice] = await db
    .select()
    .from(adaptivePracticeSchema)
    .where(
      and(
        eq(adaptivePracticeSchema.id, practiceId),
        eq(adaptivePracticeSchema.ownerId, userId),
      ),
    );
  if (!practice) {
    notFound();
  }

  const service = await getAdaptiveService(practice.id, practice.subjectId);

  // 全班診斷：引擎的 mastered / learning / locked 判定逐生計算
  const states = await service.repo.list();
  const names = await service.repo.getDisplayNames();
  const students: { studentKey: string; displayName: string; diagnosis: KnowledgeDiagnosis[] }[]
    = await Promise.all(
      states.map(async s => ({
        studentKey: s.studentId,
        displayName: names.get(s.studentId) ?? s.studentId,
        diagnosis: await service.engine.getDiagnosis(s.studentId),
      })),
    );

  // 學習日誌時間軸（最新在前）
  const events = await db
    .select()
    .from(adaptiveEventSchema)
    .where(eq(adaptiveEventSchema.practiceId, practice.id))
    .orderBy(desc(adaptiveEventSchema.createdAt))
    .limit(50);
  const knowledgeNames = new Map(service.subject.graph.nodes.map(n => [n.id, n.name]));

  // 知識點欄位以第一位學生的診斷排序為準（引擎回傳已按學習路徑排序）
  const knowledgeColumns = students[0]?.diagnosis ?? [];

  // 每位學生先算好學習後分數＝已解鎖知識點（已精熟＋學習中）的精熟度平均 ×100
  // 鎖定中的知識點從未派過題、mastery 永遠停在初始值，排除在外才能反映個別學生的實際差異
  const scoredStudents = students.map((s) => {
    const unlocked = s.diagnosis.filter(d => d.status !== 'locked');
    return {
      ...s,
      score: unlocked.length > 0
        ? Math.round(
          (unlocked.reduce((sum, d) => sum + d.mastery, 0) / unlocked.length) * 100,
        )
        : null,
      // 總作答次數：加總所有知識點的作答次數，直接反映每位學生實際花的次數差異
      totalAttempts: s.diagnosis.reduce((sum, d) => sum + d.attempts, 0),
    };
  });

  // 依網址 ?sort= 排序（無分數者視為最低分排在後面）；未指定則維持加入順序
  const sort = searchParams.sort === 'score_asc' || searchParams.sort === 'score_desc'
    ? searchParams.sort
    : null;
  if (sort === 'score_desc') {
    scoredStudents.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  } else if (sort === 'score_asc') {
    scoredStudents.sort((a, b) => (a.score ?? -1) - (b.score ?? -1));
  }

  // 日期區間篩選（簡易版）：依 updated_at 判斷「這段期間有沒有活動過」，
  // 分數仍是累計精熟度，不是該區間單獨算出來的成績（見 dateRangeFilter.ts 說明）
  const dateRange = parseDateRangeParams(searchParams);
  const updatedAtRows = await db
    .select({
      studentKey: adaptiveStudentStateSchema.studentKey,
      updatedAt: adaptiveStudentStateSchema.updatedAt,
    })
    .from(adaptiveStudentStateSchema)
    .where(eq(adaptiveStudentStateSchema.practiceId, practice.id));
  const updatedAtByKey = new Map(updatedAtRows.map(r => [r.studentKey, r.updatedAt]));
  const activeKeys = filterActiveStudentKeys(updatedAtByKey, dateRange);
  const visibleStudents = activeKeys
    ? scoredStudents.filter(s => activeKeys.has(s.studentKey))
    : scoredStudents;

  // 產生查詢字串：預設沿用目前的 sort／start／end，傳 null 明確清掉該欄位
  // （quick 連結、排序連結、匯出按鈕共用，避免互相覆蓋掉彼此的參數）
  const buildQuery = (overrides: { sort?: string | null; start?: string | null; end?: string | null }) => {
    const nextSort = overrides.sort !== undefined ? overrides.sort : sort;
    const nextStart = overrides.start !== undefined ? overrides.start : searchParams.start;
    const nextEnd = overrides.end !== undefined ? overrides.end : searchParams.end;
    const qs = new URLSearchParams();
    if (nextSort) {
      qs.set('sort', nextSort);
    }
    if (nextStart) {
      qs.set('start', nextStart);
    }
    if (nextEnd) {
      qs.set('end', nextEnd);
    }
    const str = qs.toString();
    return str ? `?${str}` : '';
  };
  const today = todayInTaipei();
  const quickPresets: { label: string; start: string; end: string }[] = [
    { label: '本週', start: mondayInTaipei(), end: today },
    { label: '本月', start: monthStartInTaipei(), end: today },
    { label: '上個月', ...lastMonthRangeInTaipei() },
  ];
  const exportHref = `/api/adaptive-practices/${practice.id}/export-csv${buildQuery({})}`;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <AutoRefresh />

      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">
          📊
          {' '}
          {practice.title}
        </h1>
        <div className="flex items-center gap-2">
          <CopyLinkButton path={`/adaptive/${practice.accessCode}`} />
          <a
            href={exportHref}
            download
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
          >
            ↓ 匯出班級成績
          </a>
          <DeletePracticeButton id={practice.id} />
        </div>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        {service.subject.name}
        {' · 學生連結：'}
        <code className="rounded bg-muted px-1.5 py-0.5">{`/adaptive/${practice.accessCode}`}</code>
        {' · 每 10 秒自動刷新'}
        {' · '}
        <Link href="/dashboard/adaptive" className="hover:underline">← 回練習清單</Link>
      </p>

      {/* 日期區間篩選（簡易版）：依 updated_at 篩「這段期間有活動的學生」，分數仍是累計精熟度 */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
        <div className="flex flex-wrap gap-1.5">
          {quickPresets.map(p => (
            <Link
              key={p.label}
              href={buildQuery({ start: p.start, end: p.end })}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                searchParams.start === p.start && searchParams.end === p.end
                  ? 'border-foreground bg-foreground text-background'
                  : 'hover:bg-muted'
              }`}
            >
              {p.label}
            </Link>
          ))}
          {dateRange && (
            <Link
              href={buildQuery({ start: null, end: null })}
              className="rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted"
            >
              全部
            </Link>
          )}
        </div>
        <form method="GET" className="flex flex-wrap items-center gap-1.5 text-xs">
          {sort && <input type="hidden" name="sort" value={sort} />}
          <input
            type="date"
            name="start"
            defaultValue={searchParams.start ?? ''}
            className="rounded-md border px-2 py-1"
          />
          <span className="text-muted-foreground">～</span>
          <input
            type="date"
            name="end"
            defaultValue={searchParams.end ?? ''}
            className="rounded-md border px-2 py-1"
          />
          <button
            type="submit"
            className="rounded-md border px-3 py-1 font-medium transition-colors hover:bg-muted"
          >
            查詢
          </button>
        </form>
        {dateRange && (
          <p className="w-full text-xs text-muted-foreground">
            💡 只顯示區間內有活動的學生，分數仍為累計精熟度，非該區間單獨成績
          </p>
        )}
      </div>

      {students.length === 0
        ? (
            <div className="rounded-lg border p-6 text-sm text-muted-foreground">
              還沒有學生加入——把上面的學生連結發給班上，輸入姓名＋學號即可開始。
            </div>
          )
        : visibleStudents.length === 0
          ? (
              <div className="rounded-lg border p-6 text-sm text-muted-foreground">
                這段期間沒有學生的活動紀錄。
              </div>
            )
          : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="px-4 py-2 font-medium">學生</th>
                      {knowledgeColumns.map(k => (
                        <th key={k.knowledgeId} className="px-4 py-2 font-medium">{k.name}</th>
                      ))}
                      <th className="px-4 py-2 font-medium">
                        {/* 點擊切換排序：高→低 ⇄ 低→高（router.refresh 會保留網址，與 10 秒自動刷新相容） */}
                        <Link
                          href={buildQuery({ sort: sort === 'score_desc' ? 'score_asc' : 'score_desc' })}
                          className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                          title="依學習後分數排序"
                        >
                          學習後分數
                          <span className="text-xs text-muted-foreground">
                            {sort === 'score_desc' ? '▼' : sort === 'score_asc' ? '▲' : '⇅'}
                          </span>
                        </Link>
                      </th>
                      <th className="px-4 py-2 font-medium">總作答次數</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleStudents.map((s) => {
                      const score = s.score;
                      // 分數區間配色：≥80 綠（大致精熟）、≥60 藍（過半）、其餘灰
                      const scoreColor = score === null
                        ? 'text-muted-foreground'
                        : score >= 80
                          ? 'text-green-600'
                          : score >= 60
                            ? 'text-blue-600'
                            : 'text-gray-500';
                      return (
                        <tr key={s.studentKey} className="border-t">
                          <td className="px-4 py-3">
                            <span className="font-medium">{s.displayName}</span>
                            <span className="ml-1 text-xs text-muted-foreground">
                              （
                              {s.studentKey}
                              ）
                            </span>
                          </td>
                          {s.diagnosis.map((d) => {
                            const meta = STATUS_META[d.status];
                            return (
                              <td key={d.knowledgeId} className="px-4 py-3">
                                <div className="text-xs">
                                  {meta.label}
                                  {' '}
                                  {(d.mastery * 100).toFixed(0)}
                                  %
                                </div>
                                <div className="my-1.5 h-1.5 w-24 overflow-hidden rounded bg-muted">
                                  <div
                                    className={`h-full ${meta.bar}`}
                                    style={{ width: `${Math.round(d.mastery * 100)}%` }}
                                  />
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  作答
                                  {' '}
                                  {d.attempts}
                                  {' '}
                                  次
                                </div>
                              </td>
                            );
                          })}
                          <td className="px-4 py-3">
                            <span className={`text-base font-bold tabular-nums ${scoreColor}`}>
                              {score === null ? '—' : score}
                            </span>
                            {score !== null && (
                              <span className="ml-0.5 text-xs text-muted-foreground">分</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="tabular-nums text-muted-foreground">{s.totalAttempts}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

      {/* 學習日誌時間軸 */}
      <h2 className="mb-2 mt-8 font-semibold">🕐 學習日誌時間軸</h2>
      {events.length === 0
        ? <p className="text-sm text-muted-foreground">尚無學習事件。</p>
        : (
            <div className="rounded-lg border px-4 py-1">
              {events.map((e) => {
                const meta = EVENT_META[e.eventType] ?? { icon: '📌', label: e.eventType };
                return (
                  <div key={e.id} className="flex items-baseline gap-2.5 border-b py-2 text-sm last:border-b-0">
                    <span className="w-36 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {e.createdAt.toLocaleString('zh-TW', { hour12: false, timeZone: 'Asia/Taipei' })}
                    </span>
                    <span className="shrink-0">{meta.icon}</span>
                    <span>
                      <span className="font-medium">{e.displayName}</span>
                      {' '}
                      {meta.label}
                      {e.knowledgeId && (
                        <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-xs">
                          {knowledgeNames.get(e.knowledgeId) ?? e.knowledgeId}
                        </span>
                      )}
                      {e.detail && (
                        <span className="ml-1.5 text-xs text-muted-foreground">{e.detail}</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
    </div>
  );
}
