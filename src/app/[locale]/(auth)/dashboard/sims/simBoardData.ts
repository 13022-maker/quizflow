/**
 * 實作模擬班級儀表板：純函式（分組、排序值、CSV、格式化），client / server 共用，不碰 DB。
 * 班級統計（平均、中位數、每題通過率、最弱 3 題）沿用 src/libs/sim/result.ts 的 summarizeClass。
 */
import { HDFIX3_ITEMS, type SimItems } from '@/libs/sim/types';

/** 儀表板用的一筆作答紀錄（由 DAO 的 sim_submission row 轉來，時間轉成 ISO 字串好傳給 client） */
export type BoardSubmission = {
  id: number;
  studentKey: string;
  displayName: string;
  seat: string;
  attemptNo: number;
  isFinal: boolean;
  startedAt: string;
  submittedAt: string;
  durationSec: number;
  score: number;
  items: SimItems;
};

/** 每位學生：最新一筆＋全部歷史（新到舊） */
export type BoardStudent = {
  studentKey: string;
  latest: BoardSubmission;
  history: BoardSubmission[];
  passedCount: number;
  totalAttempts: number;
};

export function groupByStudent(rows: BoardSubmission[]): BoardStudent[] {
  const map = new Map<string, BoardSubmission[]>();
  for (const r of rows) {
    const list = map.get(r.studentKey) ?? [];
    list.push(r);
    map.set(r.studentKey, list);
  }
  return [...map.entries()].map(([studentKey, list]) => {
    const history = [...list].sort((a, b) =>
      b.submittedAt.localeCompare(a.submittedAt) || b.attemptNo - a.attemptNo);
    const latest = history[0]!;
    let passedCount = 0;
    let totalAttempts = 0;
    for (const { id } of HDFIX3_ITEMS) {
      const c = latest.items[String(id)];
      if (c?.passed) {
        passedCount++;
      }
      totalAttempts += c?.attempts ?? 0;
    }
    return { studentKey, latest, history, passedCount, totalAttempts };
  });
}

export type SortKey = 'seat' | 'sid' | 'name' | 'score' | 'att' | 'dur' | 'sub' | `q${number}`;

/** 排序值：題目欄依「通過 > 有作答未通過 > 未作答」，同狀態次數少者在前 */
export function sortValue(s: BoardStudent, key: SortKey): number | string {
  const r = s.latest;
  switch (key) {
    case 'seat':
      return Number.parseInt(r.seat, 10) || 9999;
    case 'sid':
      return r.studentKey;
    case 'name':
      return r.displayName;
    case 'score':
      return r.score;
    case 'att':
      return s.totalAttempts;
    case 'dur':
      return r.durationSec;
    case 'sub':
      return r.submittedAt;
    default: {
      const c = r.items[key.slice(1)];
      if (!c) {
        return 0;
      }
      return (c.passed ? 2 : c.attempts ? 1 : 0) * 1000 - c.attempts;
    }
  }
}

export function compareStudents(a: BoardStudent, b: BoardStudent, key: SortKey, asc: boolean): number {
  const va = sortValue(a, key);
  const vb = sortValue(b, key);
  const c = typeof va === 'string' && typeof vb === 'string'
    ? va.localeCompare(vb, 'zh-Hant')
    : Number(va) - Number(vb);
  if (c) {
    return asc ? c : -c;
  }
  // 同值一律依座號遞增，不隨升降冪翻轉
  return Number(sortValue(a, 'seat')) - Number(sortValue(b, 'seat'));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 台北時間 YYYY-MM-DD HH:mm:ss（CSV、詳情用；server/client 時區不同也一致） */
export function formatTaipei(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  const t = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
}

/** 秒 → 分（< 10 分顯示一位小數） */
export function formatMinutes(sec: number): string {
  return (sec / 60).toFixed(sec < 600 ? 1 : 0);
}

/** 秒 → m:ss */
export function formatMmss(sec: number | null): string {
  if (sec === null) {
    return '—';
  }
  return `${Math.floor(sec / 60)}:${pad(Math.round(sec % 60))}`;
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV（UTF-8 BOM，Excel 直接開不亂碼）：
 * 座號、學號、姓名、分數、用時(分)、交卷時間、Q1..Q15（1/0）、Q1次數..Q15次數。每位學生取最新一筆。
 */
export function buildSimCsv(students: BoardStudent[]): string {
  const header = [
    '座號',
    '學號',
    '姓名',
    '分數',
    '用時(分)',
    '交卷時間',
    ...HDFIX3_ITEMS.map(it => `Q${it.id}`),
    ...HDFIX3_ITEMS.map(it => `Q${it.id}次數`),
  ];
  const sorted = [...students].sort((a, b) => compareStudents(a, b, 'seat', true));
  const lines = sorted.map(({ latest: r }) => [
    r.seat,
    r.studentKey,
    r.displayName,
    r.score,
    (r.durationSec / 60).toFixed(1),
    formatTaipei(r.submittedAt),
    ...HDFIX3_ITEMS.map(it => (r.items[String(it.id)]?.passed ? 1 : 0)),
    ...HDFIX3_ITEMS.map(it => r.items[String(it.id)]?.attempts ?? 0),
  ].map(csvCell).join(','));
  return `\uFEFF${[header.join(','), ...lines].join('\r\n')}\r\n`;
}

/** 通過率配色（同離線版 dashboard.html 四級） */
export function rateColor(ratePct: number): string {
  if (ratePct >= 80) {
    return 'bg-green-500';
  }
  if (ratePct >= 60) {
    return 'bg-blue-500';
  }
  if (ratePct >= 40) {
    return 'bg-amber-400';
  }
  return 'bg-red-500';
}

/** 分數配色（比照適性學習：≥80 綠、≥60 藍、其餘紅） */
export function scoreColor(score: number): string {
  if (score >= 80) {
    return 'text-green-600';
  }
  if (score >= 60) {
    return 'text-blue-600';
  }
  return 'text-red-600';
}
