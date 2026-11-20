/**
 * 實作模擬（hdfix3）成績解析與統計：純函式，client / server 共用，不碰 DB。
 * 分數一律由 items 重算，不採信 client 回報的 score。
 */
import { z } from 'zod';

import {
  HDFIX3_ITEM_COUNT,
  HDFIX3_ITEMS,
  HDFIX3_SPEC_KEYS,
  SIM_PASS_SCORE,
  type SimItemResult,
  type SimItems,
  type SimResultPayload,
} from './types';

const MAX_DURATION_SEC = 7 * 24 * 60 * 60; // 一週，超過視為資料異常
const MAX_ATTEMPTS = 100_000;

const isoDate = z
  .string()
  .trim()
  .max(40)
  .refine(s => !Number.isNaN(Date.parse(s)), '時間格式錯誤')
  .transform(s => new Date(s).toISOString());

const itemSchema = z.object({
  passed: z.boolean(),
  attempts: z.number().int().min(0).max(MAX_ATTEMPTS),
  firstPassSec: z.number().min(0).max(MAX_DURATION_SEC).nullable().optional(),
});

const payloadSchema = z.object({
  v: z.literal(1),
  exam: z.literal('hdfix3'),
  name: z.string().trim().min(1, '缺少姓名').max(30, '姓名最多 30 字'),
  sid: z.string().trim().min(1, '缺少學號').max(30, '學號最多 30 字'),
  seat: z.string().trim().regex(/^\d{2}$/, '崗位號碼須為兩位數字'),
  startedAt: isoDate,
  submittedAt: isoDate,
  durationSec: z.number().min(0).max(MAX_DURATION_SEC),
  score: z.number().optional(), // 會被 server 重算覆蓋
  items: z.record(z.string(), z.unknown()),
});

/** 把 items 正規化成剛好 "1"~"15" 15 題；缺題或格式錯的題目視為未通過 */
function normalizeItems(raw: Record<string, unknown>): SimItems {
  const items: SimItems = {};
  for (const { id } of HDFIX3_ITEMS) {
    const key = String(id);
    const parsed = itemSchema.safeParse(raw[key]);
    let item: SimItemResult = { passed: false, attempts: 0, firstPassSec: null };
    if (parsed.success) {
      const { passed, attempts, firstPassSec } = parsed.data;
      item = {
        passed,
        attempts,
        firstPassSec: passed && typeof firstPassSec === 'number' ? Math.round(firstPassSec) : null,
      };
    }
    items[key] = item;
  }
  return items;
}

export function parseSimResult(
  input: unknown,
): { ok: true; value: SimResultPayload } | { ok: false; error: string } {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path.join('.') ?? '';
    return { ok: false, error: `成績格式錯誤${path ? `（${path}）` : ''}：${first?.message ?? '未知錯誤'}` };
  }
  const d = parsed.data;
  const items = normalizeItems(d.items);
  return {
    ok: true,
    value: {
      v: 1,
      exam: 'hdfix3',
      name: d.name,
      sid: d.sid,
      seat: d.seat,
      startedAt: d.startedAt,
      submittedAt: d.submittedAt,
      durationSec: Math.round(d.durationSec),
      score: computeSimScore(items),
      items,
    },
  };
}

/** round(通過題數 / 15 * 100)；只計 "1"~"15" */
export function computeSimScore(items: SimItems): number {
  let passed = 0;
  for (const { id } of HDFIX3_ITEMS) {
    if (items[String(id)]?.passed === true) {
      passed++;
    }
  }
  return Math.round((passed / HDFIX3_ITEM_COUNT) * 100);
}

/** base64 / base64url（可缺 =）→ UTF-8 字串；用 atob + TextDecoder，瀏覽器與 Node 18+ 都可用 */
function decodeBase64Utf8(b64: string): string {
  let s = b64.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  while (s.length % 4) {
    s += '=';
  }
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

const CODE_RE = /HDFIX3:\s*([\w+/=-]+)/g;

/**
 * 解析老師貼上的文字：抓出所有 `HDFIX3:` 成績碼（可夾在聊天紀錄中）；
 * 沒有成績碼且整段是 JSON（物件或陣列）時直接解析 JSON。
 * 每筆都過 parseSimResult（分數重算），失敗的記到 errors。
 */
export function decodeSimCodeDetailed(text: string): { results: SimResultPayload[]; errors: string[] } {
  const results: SimResultPayload[] = [];
  const errors: string[] = [];
  const push = (obj: unknown, where: string) => {
    const r = parseSimResult(obj);
    if (r.ok) {
      results.push(r.value);
    } else {
      errors.push(`${where}：${r.error}`);
    }
  };

  const matches = [...text.matchAll(CODE_RE)];
  if (matches.length > 0) {
    matches.forEach((m, i) => {
      const where = `第 ${i + 1} 個成績碼`;
      let obj: unknown;
      try {
        obj = JSON.parse(decodeBase64Utf8(m[1]!));
      } catch {
        errors.push(`${where}：無法解碼，可能複製不完整`);
        return;
      }
      push(obj, where);
    });
    return { results, errors };
  }

  const trimmed = text.trim();
  if (/^[[{]/.test(trimmed)) {
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      errors.push('JSON 格式錯誤');
      return { results, errors };
    }
    const list = Array.isArray(obj) ? obj : [obj];
    list.forEach((o, i) => push(o, list.length > 1 ? `第 ${i + 1} 筆 JSON` : 'JSON'));
  }
  return { results, errors };
}

/** 同 decodeSimCodeDetailed，只回傳成功解析的成績 */
export function decodeSimCode(text: string): SimResultPayload[] {
  return decodeSimCodeDetailed(text).results;
}

export type SimSummaryRow = { score: number; durationSec: number; items: SimItems };

export type SimItemPassRate = {
  id: number;
  title: string;
  passedCount: number;
  passRate: number; // 0~100，四捨五入到整數
};

export type SimClassSummary = {
  count: number;
  avgScore: number | null; // 取到小數一位
  medianScore: number | null;
  passRate: number | null; // 分數 ≥ 60 的百分比（0~100 整數）
  avgDurationSec: number | null; // 四捨五入到整數秒
  itemPassRates: SimItemPassRate[]; // 15 題，依題號
  weakest: SimItemPassRate[]; // 通過率最低 3 題（同率題號小者優先）；無人作答時為 []
};

/** 班級統計：rows 應為「每位學生一筆」（通常取最新一筆） */
export function summarizeClass(rows: SimSummaryRow[]): SimClassSummary {
  const count = rows.length;
  const itemPassRates: SimItemPassRate[] = HDFIX3_ITEMS.map(({ id, title }) => {
    const passedCount = rows.filter(r => r.items[String(id)]?.passed === true).length;
    return { id, title, passedCount, passRate: count ? Math.round((passedCount / count) * 100) : 0 };
  });

  if (count === 0) {
    return {
      count,
      avgScore: null,
      medianScore: null,
      passRate: null,
      avgDurationSec: null,
      itemPassRates,
      weakest: [],
    };
  }

  const scores = rows.map(r => r.score).sort((a, b) => a - b);
  const mid = Math.floor(count / 2);
  const medianScore = count % 2 ? scores[mid]! : (scores[mid - 1]! + scores[mid]!) / 2;
  const sum = scores.reduce((a, b) => a + b, 0);
  const passCount = scores.filter(s => s >= SIM_PASS_SCORE).length;
  const durationSum = rows.reduce((a, r) => a + r.durationSec, 0);

  const weakest = [...itemPassRates]
    .sort((a, b) => a.passRate - b.passRate || a.passedCount - b.passedCount || a.id - b.id)
    .slice(0, 3);

  return {
    count,
    avgScore: Math.round((sum / count) * 10) / 10,
    medianScore,
    passRate: Math.round((passCount / count) * 100),
    avgDurationSec: Math.round(durationSum / count),
    itemPassRates,
    weakest,
  };
}

const specValueSchema = z.union([
  z.string().max(200),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(50)).max(20),
]);

/**
 * 老師填的監評指定內容（spec 覆蓋值）：只保留 HDFIX3_SPEC_KEYS 內的欄位，
 * 值限 字串(≤200) / 有限數字 / 布林 / 字串陣列；未知 key 直接丟掉。
 * 實際值域（例如 winIP 只能 static/dhcp）由 hdfix3 頁面自己的 urlSpec 邏輯再把關。
 */
export function sanitizeSimSpec(
  input: unknown,
): { ok: true; value: Record<string, unknown> | null } | { ok: false; error: string } {
  if (input == null) {
    return { ok: true, value: null };
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: '指定內容格式錯誤' };
  }
  const out: Record<string, unknown> = {};
  const allowed = new Set<string>(HDFIX3_SPEC_KEYS);
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!allowed.has(key) || raw == null || raw === '') {
      continue;
    }
    const parsed = specValueSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: `指定內容欄位 ${key} 格式錯誤` };
    }
    out[key] = parsed.data;
  }
  return { ok: true, value: Object.keys(out).length ? out : null };
}
