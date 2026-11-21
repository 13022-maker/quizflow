'use client';

/**
 * 實作模擬班級儀表板（client）：總覽卡片、15 題通過率＋最弱 3 題＋Windows/Linux 分組、
 * 學生×題目矩陣（✅/❌/— 與次數，可排序、搜尋）、學生詳情對話框（含歷次紀錄）。
 * 版面沿用離線版 hdfix3 dashboard.html；資料由 server page 每 10 秒 router.refresh 更新，
 * 排序／搜尋／開啟中的對話框都是 client state，刷新時會保留。
 */
import { useMemo, useState } from 'react';

import type { SimClassSummary } from '@/libs/sim/result';
import { HDFIX3_ITEMS, type SimMode } from '@/libs/sim/types';

import {
  type BoardStudent,
  type BoardSubmission,
  compareStudents,
  formatMinutes,
  formatMmss,
  formatTaipei,
  rateColor,
  scoreColor,
  type SortKey,
} from '../simBoardData';
import { SimModal } from './SimModal';

const OS_META = {
  win: { label: 'Windows', cls: 'bg-sky-50 text-sky-700' },
  lx: { label: 'Linux', cls: 'bg-orange-50 text-orange-700' },
  both: { label: '雙系統', cls: 'bg-violet-50 text-violet-700' },
} as const;

function OsTag({ os }: { os: keyof typeof OS_META }) {
  const m = OS_META[os];
  return <span className={`whitespace-nowrap rounded-full px-1.5 py-px text-[11px] font-medium ${m.cls}`}>{m.label}</span>;
}

function Kpi({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-blue-600">
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
      </div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'seat', label: '依崗位' },
  { value: 'score', label: '依分數' },
  { value: 'dur', label: '依用時' },
  { value: 'att', label: '依總作答次數' },
  { value: 'sub', label: '依時間' },
  { value: 'name', label: '依姓名' },
];

export function SimBoard({
  mode,
  students,
  summary,
}: {
  mode: SimMode;
  students: BoardStudent[];
  summary: SimClassSummary;
}) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('seat');
  const [sortAsc, setSortAsc] = useState(true);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const isPractice = mode === 'practice';
  const timeLabel = isPractice ? '最後更新' : '交卷時間';
  const weakIds = new Set(summary.weakest.map(w => w.id));
  const n = students.length;

  // 每題：作答過人數、平均作答次數（summarizeClass 只算通過率，這兩項在此補）
  const itemExtra = useMemo(() => HDFIX3_ITEMS.map(({ id }) => {
    let tried = 0;
    let attempts = 0;
    for (const s of students) {
      const c = s.latest.items[String(id)];
      if (c && c.attempts > 0) {
        tried++;
      }
      attempts += c?.attempts ?? 0;
    }
    return { tried, avgAttempts: n ? attempts / n : 0 };
  }), [students, n]);

  const groups = (['win', 'lx', 'both'] as const).map((os) => {
    const rates = summary.itemPassRates.filter(r => HDFIX3_ITEMS[r.id - 1]?.os === os);
    const avg = rates.length ? Math.round(rates.reduce((a, r) => a + r.passRate, 0) / rates.length) : 0;
    return { os, count: rates.length, avg };
  });

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students
      .filter(s => !q || `${s.latest.displayName} ${s.studentKey} ${s.latest.seat}`.toLowerCase().includes(q))
      .sort((a, b) => compareStudents(a, b, sortKey, sortAsc));
  }, [students, query, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(v => !v);
    } else {
      setSortKey(key);
      setSortAsc(key === 'seat' || key === 'sid' || key === 'name');
    }
  }

  const arrow = (key: SortKey) => (sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : '');
  const openStudent = openKey ? students.find(s => s.studentKey === openKey) ?? null : null;

  return (
    <div className="flex flex-col gap-6">
      {/* 總覽卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label={isPractice ? '作答人數' : '交卷人數'} value={String(summary.count)} unit="人" />
        <Kpi label="平均分" value={summary.avgScore?.toFixed(1) ?? '—'} unit="分" />
        <Kpi label="中位數" value={summary.medianScore === null ? '—' : String(+summary.medianScore.toFixed(1))} unit="分" />
        <Kpi
          label="及格率（≥60）"
          value={summary.passRate === null ? '—' : String(summary.passRate)}
          unit="%"
          sub={summary.count ? `${students.filter(s => s.latest.score >= 60).length}/${summary.count} 人` : undefined}
        />
        <Kpi
          label="平均作答時間"
          value={summary.avgDurationSec === null ? '—' : formatMinutes(summary.avgDurationSec)}
          unit="分"
        />
      </div>

      {/* 題目通過率 */}
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">📈 題目通過率</h2>
          <span className="text-xs text-muted-foreground">
            {isPractice ? '以每位學生目前進度計算' : '以每位學生最新一次交卷計算'}
          </span>
        </div>
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          {groups.map(g => (
            <div key={g.os} className="flex items-center gap-1.5 rounded-lg border bg-muted/30 px-3 py-1.5">
              <OsTag os={g.os} />
              <span className="text-muted-foreground">{`${g.count} 題 · 平均通過率`}</span>
              <b className="tabular-nums">{`${g.avg}%`}</b>
            </div>
          ))}
          {summary.weakest.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-red-700">
              <span className="font-medium">最弱 3 題：</span>
              {summary.weakest.map((w, i) => (
                <span key={w.id}>
                  <b>{`Q${w.id}`}</b>
                  {` ${w.title}（${w.passRate}%）`}
                  {i < summary.weakest.length - 1 ? '、' : ''}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 text-sm">
          {summary.itemPassRates.map((r) => {
            const item = HDFIX3_ITEMS[r.id - 1]!;
            const extra = itemExtra[r.id - 1]!;
            return (
              <div key={r.id} className="contents">
                <div className="flex min-w-0 max-w-44 items-center gap-1.5 sm:max-w-72" title={item.title}>
                  <b className="w-8 shrink-0 font-mono text-xs">{`Q${r.id}`}</b>
                  <span className="truncate">{item.title}</span>
                  <span className="hidden sm:inline"><OsTag os={item.os} /></span>
                  {weakIds.has(r.id) && (
                    <span className="shrink-0 rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">弱</span>
                  )}
                </div>
                <div
                  className="h-4 overflow-hidden rounded bg-muted"
                  title={`通過 ${r.passedCount}/${n}，作答過 ${extra.tried} 人，平均 ${extra.avgAttempts.toFixed(1)} 次`}
                >
                  <div className={`h-full rounded ${rateColor(r.passRate)}`} style={{ width: `${r.passRate}%` }} />
                </div>
                <div className="whitespace-nowrap text-right font-mono text-xs tabular-nums">
                  {`${r.passRate}%`}
                  <span className="ml-1 text-muted-foreground">{`(${r.passedCount}/${n}) ${extra.avgAttempts.toFixed(1)}次`}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {[
            ['bg-green-500', '≥ 80%'],
            ['bg-blue-500', '60–79%'],
            ['bg-amber-400', '40–59%'],
            ['bg-red-500', '< 40%'],
          ].map(([c, l]) => (
            <span key={l} className="inline-flex items-center gap-1">
              <span className={`inline-block size-2.5 rounded-sm ${c}`} />
              {l}
            </span>
          ))}
        </div>
      </section>

      {/* 學生矩陣 */}
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">👥 學生矩陣</h2>
          <span className="text-xs text-muted-foreground">
            ✅ 已通過／❌ 未通過／— 未作答，小字為作答次數；點姓名看詳情、點欄位標題排序
          </span>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜尋姓名／學號／崗位"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 sm:w-56"
          />
          <select
            value={SORT_OPTIONS.some(o => o.value === sortKey) ? sortKey : ''}
            onChange={e => setSortKey(e.target.value as SortKey)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            {!SORT_OPTIONS.some(o => o.value === sortKey) && <option value="">依題目</option>}
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button
            type="button"
            onClick={() => setSortAsc(v => !v)}
            className="h-9 rounded-md border px-3 text-xs font-medium hover:bg-muted"
          >
            {sortAsc ? '遞增 ↑' : '遞減 ↓'}
          </button>
          <span className="text-xs text-muted-foreground">{`顯示 ${list.length} / ${n} 人`}</span>
        </div>

        <div className="overflow-x-auto rounded-lg border [-webkit-overflow-scrolling:touch]">
          <table className="min-w-full whitespace-nowrap text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="sticky left-0 z-10 cursor-pointer border-r bg-muted px-3 py-2 text-left font-medium" onClick={() => toggleSort('seat')}>
                  {`崗位／姓名${arrow('seat')}`}
                </th>
                <th className="cursor-pointer p-2 font-medium" onClick={() => toggleSort('sid')}>{`學號${arrow('sid')}`}</th>
                {HDFIX3_ITEMS.map(it => (
                  <th
                    key={it.id}
                    title={`${it.title}（${OS_META[it.os].label}）`}
                    onClick={() => toggleSort(`q${it.id}`)}
                    className={`cursor-pointer px-1 py-2 font-mono font-medium ${weakIds.has(it.id) ? 'text-red-600' : ''}`}
                  >
                    {`Q${it.id}${arrow(`q${it.id}`)}`}
                  </th>
                ))}
                <th className="cursor-pointer p-2 font-medium" onClick={() => toggleSort('score')}>{`分數${arrow('score')}`}</th>
                <th className="cursor-pointer p-2 font-medium" onClick={() => toggleSort('att')}>{`總次數${arrow('att')}`}</th>
                <th className="cursor-pointer p-2 font-medium" onClick={() => toggleSort('dur')}>{`用時(分)${arrow('dur')}`}</th>
                <th className="cursor-pointer p-2 font-medium" onClick={() => toggleSort('sub')}>{`${timeLabel}${arrow('sub')}`}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const r = s.latest;
                return (
                  <tr key={s.studentKey} className="border-t hover:bg-muted/30">
                    <td className="sticky left-0 z-10 border-r bg-card px-3 py-1.5 text-left">
                      <span className="mr-1.5 font-mono text-muted-foreground">{r.seat || '--'}</span>
                      <button
                        type="button"
                        onClick={() => setOpenKey(s.studentKey)}
                        className="font-semibold text-primary hover:underline"
                      >
                        {r.displayName}
                      </button>
                      {!r.isFinal && (
                        <span className="ml-1.5 rounded-full bg-emerald-50 px-1.5 py-px text-[10px] font-medium text-emerald-700">進行中</span>
                      )}
                      {s.history.length > 1 && (
                        <span
                          className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700"
                          title={`共交卷 ${s.history.length} 次`}
                        >
                          {`×${s.history.length}`}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center font-mono">{s.studentKey}</td>
                    {HDFIX3_ITEMS.map((it) => {
                      const c = r.items[String(it.id)] ?? { passed: false, attempts: 0, firstPassSec: null };
                      const cls = c.passed ? 'bg-green-50' : c.attempts ? 'bg-red-50' : 'text-gray-400';
                      return (
                        <td
                          key={it.id}
                          className={`min-w-10 px-1 py-1.5 text-center ${cls}`}
                          title={`Q${it.id} ${it.title}：${c.passed ? '已通過' : c.attempts ? '未通過' : '未作答'}，${c.attempts} 次${c.firstPassSec !== null ? `，首次通過 ${formatMmss(c.firstPassSec)}` : ''}`}
                        >
                          {c.passed ? '✅' : c.attempts ? '❌' : '—'}
                          {c.attempts > 0 && <sub className="ml-px font-mono text-[10px] text-muted-foreground">{c.attempts}</sub>}
                        </td>
                      );
                    })}
                    <td className={`px-2 py-1.5 text-center text-sm font-bold tabular-nums ${scoreColor(r.score)}`}>{r.score}</td>
                    <td className="px-2 py-1.5 text-center font-mono">{s.totalAttempts}</td>
                    <td className="px-2 py-1.5 text-center font-mono">{formatMinutes(r.durationSec)}</td>
                    <td className="px-2 py-1.5 text-center font-mono">{formatTaipei(r.submittedAt).slice(5, 16)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {openStudent && (
        <StudentDetail student={openStudent} timeLabel={timeLabel} onClose={() => setOpenKey(null)} />
      )}
    </div>
  );
}

function StudentDetail({
  student,
  timeLabel,
  onClose,
}: {
  student: BoardStudent;
  timeLabel: string;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<number>(student.latest.id);
  const rec: BoardSubmission = student.history.find(h => h.id === selectedId) ?? student.latest;
  const passed = HDFIX3_ITEMS.filter(it => rec.items[String(it.id)]?.passed).length;
  const attempts = HDFIX3_ITEMS.reduce((a, it) => a + (rec.items[String(it.id)]?.attempts ?? 0), 0);

  return (
    <SimModal
      onClose={onClose}
      title={(
        <div>
          <h3 className="text-lg font-semibold">{rec.displayName}</h3>
          <p className="text-xs text-muted-foreground">{`崗位 ${rec.seat || '—'} · 學號 ${student.studentKey}`}</p>
        </div>
      )}
    >
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span>
          分數
          {' '}
          <b className={`text-2xl tabular-nums ${scoreColor(rec.score)}`}>{rec.score}</b>
        </span>
        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
          {`✅ 通過 ${passed}/15 · ${Math.round((passed / 15) * 100)}%`}
        </span>
        <span className="text-xs text-muted-foreground">
          {`總作答 ${attempts} 次 · 用時 ${formatMinutes(rec.durationSec)} 分 · ${timeLabel} ${formatTaipei(rec.submittedAt)}`}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full whitespace-nowrap text-sm">
          <thead className="bg-muted/50 text-left text-xs">
            <tr>
              <th className="px-3 py-1.5 font-medium">題目</th>
              <th className="px-3 py-1.5 font-medium">系統</th>
              <th className="px-3 py-1.5 font-medium">狀態</th>
              <th className="px-3 py-1.5 font-medium">次數</th>
              <th className="px-3 py-1.5 font-medium">首次通過</th>
            </tr>
          </thead>
          <tbody>
            {HDFIX3_ITEMS.map((it) => {
              const c = rec.items[String(it.id)] ?? { passed: false, attempts: 0, firstPassSec: null };
              return (
                <tr key={it.id} className="border-t">
                  <td className="px-3 py-1.5">
                    <b className="mr-1.5 font-mono text-xs">{`Q${it.id}`}</b>
                    {it.title}
                  </td>
                  <td className="px-3 py-1.5"><OsTag os={it.os} /></td>
                  <td className={`px-3 py-1.5 font-semibold ${c.passed ? 'text-green-600' : c.attempts ? 'text-red-600' : 'text-gray-400'}`}>
                    {c.passed ? '✅ 通過' : c.attempts ? '❌ 未通過' : '— 未作答'}
                  </td>
                  <td className="px-3 py-1.5 font-mono">{c.attempts}</td>
                  <td className="px-3 py-1.5 font-mono">{formatMmss(c.firstPassSec)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {student.history.length > 1 && (
        <>
          <h4 className="mb-2 mt-5 text-sm font-semibold">{`歷次紀錄（${student.history.length} 次，點選切換）`}</h4>
          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full whitespace-nowrap text-sm">
              <thead className="bg-muted/50 text-left text-xs">
                <tr>
                  <th className="px-3 py-1.5 font-medium">第幾次</th>
                  <th className="px-3 py-1.5 font-medium">{timeLabel}</th>
                  <th className="px-3 py-1.5 font-medium">分數</th>
                  <th className="px-3 py-1.5 font-medium">通過</th>
                  <th className="px-3 py-1.5 font-medium">用時(分)</th>
                </tr>
              </thead>
              <tbody>
                {student.history.map((h) => {
                  const p = HDFIX3_ITEMS.filter(it => h.items[String(it.id)]?.passed).length;
                  return (
                    <tr
                      key={h.id}
                      onClick={() => setSelectedId(h.id)}
                      className={`cursor-pointer border-t hover:bg-muted/40 ${h.id === rec.id ? 'bg-primary/5' : ''}`}
                    >
                      <td className="px-3 py-1.5">
                        {`#${h.attemptNo}`}
                        {h.id === student.latest.id && <span className="ml-1.5 text-xs text-muted-foreground">最新</span>}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs">{formatTaipei(h.submittedAt)}</td>
                      <td className={`px-3 py-1.5 font-bold tabular-nums ${scoreColor(h.score)}`}>{h.score}</td>
                      <td className="px-3 py-1.5 font-mono">{`${p}/15`}</td>
                      <td className="px-3 py-1.5 font-mono">{formatMinutes(h.durationSec)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </SimModal>
  );
}
