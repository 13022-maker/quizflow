import { describe, expect, it } from 'vitest';

import type { SimItems } from '@/libs/sim/types';

import { type BoardSubmission, buildSimCsv, compareStudents, formatTaipei, groupByStudent } from './simBoardData';

function items(passed: number[], attempts: Record<number, number> = {}): SimItems {
  const out: SimItems = {};
  for (let i = 1; i <= 15; i++) {
    out[String(i)] = {
      passed: passed.includes(i),
      attempts: attempts[i] ?? (passed.includes(i) ? 1 : 0),
      firstPassSec: null,
    };
  }
  return out;
}

function row(p: Partial<BoardSubmission> & Pick<BoardSubmission, 'id' | 'studentKey'>): BoardSubmission {
  return {
    displayName: '王小明',
    seat: '01',
    attemptNo: 1,
    isFinal: true,
    startedAt: '2026-11-20T01:00:00.000Z',
    submittedAt: '2026-11-20T01:30:00.000Z',
    durationSec: 1800,
    score: 0,
    items: items([]),
    ...p,
  };
}

describe('groupByStudent', () => {
  it('每位學生取最新一筆，歷史新到舊', () => {
    const students = groupByStudent([
      row({ id: 1, studentKey: 'S1', attemptNo: 1, submittedAt: '2026-11-20T01:00:00.000Z', score: 7 }),
      row({ id: 2, studentKey: 'S1', attemptNo: 2, submittedAt: '2026-11-20T02:00:00.000Z', score: 13, items: items([1, 2], { 3: 2 }) }),
      row({ id: 3, studentKey: 'S2', seat: '02' }),
    ]);

    expect(students).toHaveLength(2);

    const s1 = students.find(s => s.studentKey === 'S1')!;

    expect(s1.latest.id).toBe(2);
    expect(s1.history.map(h => h.id)).toEqual([2, 1]);
    expect(s1.passedCount).toBe(2);
    expect(s1.totalAttempts).toBe(4);
  });
});

describe('compareStudents', () => {
  it('依分數遞減，同分以座號遞增', () => {
    const students = groupByStudent([
      row({ id: 1, studentKey: 'A', seat: '03', score: 60 }),
      row({ id: 2, studentKey: 'B', seat: '01', score: 80 }),
      row({ id: 3, studentKey: 'C', seat: '02', score: 60 }),
    ]);
    const order = [...students].sort((a, b) => compareStudents(a, b, 'score', false)).map(s => s.studentKey);

    expect(order).toEqual(['B', 'C', 'A']);
  });
});

describe('formatTaipei', () => {
  it('UTC 轉台北時間（+8）', () => {
    expect(formatTaipei('2026-11-20T16:05:09.000Z')).toBe('2026-11-21 00:05:09');
  });
});

describe('buildSimCsv', () => {
  it('BOM＋規格欄位順序＋依座號排序＋含逗號欄位加引號', () => {
    const csv = buildSimCsv(groupByStudent([
      row({ id: 1, studentKey: 'S2', seat: '02', displayName: '林,一', score: 7, durationSec: 90, items: items([15], { 15: 3 }) }),
      row({ id: 2, studentKey: 'S1', seat: '01', displayName: '陳二', score: 0, durationSec: 600 }),
    ]));
    const lines = csv.split('\r\n');

    expect(csv.startsWith('\uFEFF座號,學號,姓名,分數,用時(分),交卷時間,Q1,')).toBe(true);
    expect(lines[0]!.endsWith('Q14次數,Q15次數')).toBe(true);
    expect(lines[1]).toBe('01,S1,陳二,0,10.0,2026-11-20 09:30:00,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0');
    expect(lines[2]).toBe('02,S2,"林,一",7,1.5,2026-11-20 09:30:00,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3');
  });
});
