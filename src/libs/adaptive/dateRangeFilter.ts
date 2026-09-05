/**
 * 適性學習班級儀表板 — 日期區間篩選共用工具（page.tsx 與 export-csv route 共用）
 *
 * 「簡易版」篩選：適性學習沒有逐次作答的時間戳紀錄（adaptive_student_state 只存
 * 累計到目前的精熟度，見設計討論），所以這裡只能依 updatedAt 判斷「這段期間有沒有
 * 活動過」，分數本身仍是累計精熟度，不是該區間單獨算出來的成績。
 */

export type DateRange = { start: Date; end: Date };

function taipeiDateParts(d: Date): { y: number; m: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return { y: get('year'), m: get('month'), day: get('day') };
}

function toDateString(y: number, m: number, day: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 今天（台北時區）的 yyyy-MM-dd */
export function todayInTaipei(now: Date = new Date()): string {
  const { y, m, day } = taipeiDateParts(now);
  return toDateString(y, m, day);
}

/** 本週一（台北時區）的 yyyy-MM-dd */
export function mondayInTaipei(now: Date = new Date()): string {
  const { y, m, day } = taipeiDateParts(now);
  // 用 UTC 建構避免執行環境本機時區干擾「星期幾」計算
  const d = new Date(Date.UTC(y, m - 1, day));
  const dow = d.getUTCDay(); // 0 = 週日
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return toDateString(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** 本月 1 號（台北時區）的 yyyy-MM-dd */
export function monthStartInTaipei(now: Date = new Date()): string {
  const { y, m } = taipeiDateParts(now);
  return toDateString(y, m, 1);
}

/** 上個月第一天／最後一天（台北時區）的 yyyy-MM-dd */
export function lastMonthRangeInTaipei(now: Date = new Date()): { start: string; end: string } {
  const { y, m } = taipeiDateParts(now);
  const firstOfThisMonth = new Date(Date.UTC(y, m - 1, 1));
  const lastMonthEnd = new Date(firstOfThisMonth.getTime() - 1); // 上月最後一天（UTC 前一毫秒）
  const lastMonthStart = new Date(Date.UTC(lastMonthEnd.getUTCFullYear(), lastMonthEnd.getUTCMonth(), 1));
  return {
    start: toDateString(lastMonthStart.getUTCFullYear(), lastMonthStart.getUTCMonth() + 1, lastMonthStart.getUTCDate()),
    end: toDateString(lastMonthEnd.getUTCFullYear(), lastMonthEnd.getUTCMonth() + 1, lastMonthEnd.getUTCDate()),
  };
}

/**
 * 解析 ?start=&end= 查詢參數為日期區間；缺任一個、格式不對、或 start 晚於 end
 * 就回傳 null（＝不篩選，顯示全部）。end 視為當天結束（23:59:59.999，台北時區）。
 */
export function parseDateRangeParams(params: { start?: string; end?: string }): DateRange | null {
  const { start, end } = params;
  if (!start || !end) {
    return null;
  }
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
    return null;
  }
  // 明確指定 +08:00（台北）邊界，避免 server 端 UTC 執行環境誤判當天範圍
  const startDate = new Date(`${start}T00:00:00+08:00`);
  const endDate = new Date(`${end}T23:59:59.999+08:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate > endDate) {
    return null;
  }
  return { start: startDate, end: endDate };
}

/**
 * 依 updatedAt 篩選出「區間內有活動」的 studentKey 集合。
 * range 為 null（未篩選）時回傳 null，呼叫端據此判斷要不要套用篩選。
 */
export function filterActiveStudentKeys(
  updatedAtByKey: Map<string, Date>,
  range: DateRange | null,
): Set<string> | null {
  if (!range) {
    return null;
  }
  const result = new Set<string>();
  for (const [key, updatedAt] of updatedAtByKey) {
    if (updatedAt >= range.start && updatedAt <= range.end) {
      result.add(key);
    }
  }
  return result;
}
