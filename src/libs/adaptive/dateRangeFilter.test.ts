import { describe, expect, it } from 'vitest';

import {
  filterActiveStudentKeys,
  lastMonthRangeInTaipei,
  mondayInTaipei,
  monthStartInTaipei,
  parseDateRangeParams,
  todayInTaipei,
} from './dateRangeFilter';

describe('parseDateRangeParams', () => {
  it('start／end 都合法時回傳區間', () => {
    const range = parseDateRangeParams({ start: '2026-09-01', end: '2026-09-05' });

    expect(range).not.toBeNull();
    expect(range!.start.toISOString()).toBe('2026-08-31T16:00:00.000Z'); // 台北 9/1 00:00 = UTC 8/31 16:00
    expect(range!.end.toISOString()).toBe('2026-09-05T15:59:59.999Z'); // 台北 9/5 23:59:59.999
  });

  it('缺 start 或 end 回傳 null', () => {
    expect(parseDateRangeParams({ end: '2026-09-05' })).toBeNull();
    expect(parseDateRangeParams({ start: '2026-09-01' })).toBeNull();
    expect(parseDateRangeParams({})).toBeNull();
  });

  it('格式不對回傳 null', () => {
    expect(parseDateRangeParams({ start: '2026/09/01', end: '2026-09-05' })).toBeNull();
    expect(parseDateRangeParams({ start: 'abc', end: '2026-09-05' })).toBeNull();
  });

  it('start 晚於 end 回傳 null', () => {
    expect(parseDateRangeParams({ start: '2026-09-10', end: '2026-09-05' })).toBeNull();
  });

  it('start 等於 end（單日查詢）合法', () => {
    const range = parseDateRangeParams({ start: '2026-09-05', end: '2026-09-05' });

    expect(range).not.toBeNull();
  });
});

describe('台北時區快選日期', () => {
  it('todayInTaipei 回傳 yyyy-MM-dd 格式', () => {
    expect(todayInTaipei(new Date('2026-09-05T10:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('mondayInTaipei 回傳的是週一', () => {
    // 2026-09-05（六）UTC 10:00 → 台北時間仍是 9/5（六）
    const monday = mondayInTaipei(new Date('2026-09-05T10:00:00Z'));

    expect(monday).toBe('2026-08-31'); // 該週週一
  });

  it('mondayInTaipei 遇到週日回推到前一個週一（不是往後）', () => {
    // 2026-09-06 是週日
    const monday = mondayInTaipei(new Date('2026-09-06T10:00:00Z'));

    expect(monday).toBe('2026-08-31');
  });

  it('monthStartInTaipei 回傳當月 1 號', () => {
    expect(monthStartInTaipei(new Date('2026-09-15T10:00:00Z'))).toBe('2026-09-01');
  });

  it('lastMonthRangeInTaipei 回傳上個月完整區間', () => {
    const range = lastMonthRangeInTaipei(new Date('2026-09-15T10:00:00Z'));

    expect(range).toEqual({ start: '2026-08-01', end: '2026-08-31' });
  });

  it('lastMonthRangeInTaipei 跨年時正確回推到去年 12 月', () => {
    const range = lastMonthRangeInTaipei(new Date('2026-01-15T10:00:00Z'));

    expect(range).toEqual({ start: '2025-12-01', end: '2025-12-31' });
  });
});

describe('filterActiveStudentKeys', () => {
  it('range 為 null 時回傳 null（表示不篩選）', () => {
    const map = new Map([['s1', new Date('2026-09-01')]]);

    expect(filterActiveStudentKeys(map, null)).toBeNull();
  });

  it('只留下 updatedAt 落在區間內的 studentKey', () => {
    const map = new Map([
      ['s1', new Date('2026-09-01T00:00:00Z')], // 區間外（太早）
      ['s2', new Date('2026-09-03T00:00:00Z')], // 區間內
      ['s3', new Date('2026-09-10T00:00:00Z')], // 區間外（太晚）
    ]);
    const range = parseDateRangeParams({ start: '2026-09-02', end: '2026-09-05' })!;
    const result = filterActiveStudentKeys(map, range);

    expect(result).toEqual(new Set(['s2']));
  });

  it('邊界值（正好等於 start/end）算在區間內', () => {
    const range = parseDateRangeParams({ start: '2026-09-01', end: '2026-09-01' })!;
    const map = new Map([['s1', range.start], ['s2', range.end]]);
    const result = filterActiveStudentKeys(map, range);

    expect(result).toEqual(new Set(['s1', 's2']));
  });
});
