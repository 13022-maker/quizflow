// 實作模擬 DAO 整合測試：真實 Postgres（無 DATABASE_URL 時 src/libs/DB.ts 自動用 in-memory PGlite，並套用 migration）。
import { describe, expect, it } from 'vitest';

import { db } from '@/libs/DB';
import { simPracticeSchema } from '@/models/Schema';

import {
  getSimPracticeByCode,
  getSimPracticeForOwner,
  importSubmissions,
  insertExamSubmission,
  listSimPractices,
  listSubmissions,
  upsertPracticeProgress,
} from './dao';
import type { SimItems, SimResultPayload } from './types';

function items(passedIds: number[]): SimItems {
  const out: SimItems = {};
  for (let i = 1; i <= 15; i++) {
    out[String(i)] = passedIds.includes(i)
      ? { passed: true, attempts: 1, firstPassSec: 10 }
      : { passed: false, attempts: 0, firstPassSec: null };
  }
  return out;
}

function payload(sid: string, submittedAt: string, score: number, passed: number[], seat = '01'): SimResultPayload {
  return {
    v: 1,
    exam: 'hdfix3',
    name: `學生${sid}`,
    sid,
    seat,
    startedAt: '2026-11-20T01:00:00.000Z',
    submittedAt,
    durationSec: 600,
    score,
    items: items(passed),
  };
}

let seq = 0;
async function createPractice(mode: 'practice' | 'exam', ownerId = 'user_a') {
  seq++;
  const [row] = await db
    .insert(simPracticeSchema)
    .values({ ownerId, mode, title: `t${seq}`, accessCode: `code${seq}${mode}`.slice(0, 12) })
    .returning();
  return row!;
}

describe('sim dao', () => {
  it('依分享碼 / owner 查練習；別人的練習查不到', async () => {
    const p = await createPractice('exam', 'owner_x');

    expect((await getSimPracticeByCode(p.accessCode))?.id).toBe(p.id);
    expect(await getSimPracticeByCode('nope')).toBeUndefined();
    expect((await getSimPracticeForOwner(p.id, 'owner_x'))?.id).toBe(p.id);
    expect(await getSimPracticeForOwner(p.id, 'someone_else')).toBeUndefined();
  });

  it('exam：同一學生每次交卷 attemptNo 1、2，皆 isFinal', async () => {
    const p = await createPractice('exam');
    const a = await insertExamSubmission(p.id, payload('s1', '2026-11-20T01:10:00.000Z', 13, [1, 2]));
    const b = await insertExamSubmission(p.id, payload('s1', '2026-11-20T01:20:00.000Z', 20, [1, 2, 3]));
    const c = await insertExamSubmission(p.id, payload('s2', '2026-11-20T01:20:00.000Z', 0, []));

    expect([a.attemptNo, b.attemptNo, c.attemptNo]).toEqual([1, 2, 1]);
    expect(a.isFinal && b.isFinal).toBe(true);

    const list = await listSubmissions(p.id);

    expect(list.map(s => s.studentKey)).toEqual(['s1', 's2']);
    expect(list[0]!.latest.attemptNo).toBe(2);
    expect(list[0]!.latest.score).toBe(20);
    expect(list[0]!.history.map(h => h.attemptNo)).toEqual([2, 1]);
  });

  it('exam：同一學生同時交卷兩次也不會撞號', async () => {
    const p = await createPractice('exam');
    const rows = await Promise.all([
      insertExamSubmission(p.id, payload('s9', '2026-11-20T01:10:00.000Z', 0, [])),
      insertExamSubmission(p.id, payload('s9', '2026-11-20T01:11:00.000Z', 0, [])),
    ]);

    expect(rows.map(r => r.attemptNo).sort()).toEqual([1, 2]);
  });

  it('practice：upsert 同一筆（attemptNo 1、isFinal false），較舊的進度不覆蓋較新的', async () => {
    const p = await createPractice('practice');
    await upsertPracticeProgress(p.id, payload('s1', '2026-11-20T01:10:00.000Z', 7, [1]));
    const newer = await upsertPracticeProgress(p.id, payload('s1', '2026-11-20T01:20:00.000Z', 13, [1, 2]));
    const stale = await upsertPracticeProgress(p.id, payload('s1', '2026-11-20T01:15:00.000Z', 7, [1]));

    expect(newer.attemptNo).toBe(1);
    expect(newer.isFinal).toBe(false);
    expect(stale.score).toBe(13); // 回傳既有較新那筆

    const list = await listSubmissions(p.id);

    expect(list).toHaveLength(1);
    expect(list[0]!.history).toHaveLength(1);
    expect(list[0]!.latest.score).toBe(13);
  });

  it('importSubmissions（exam）：同學號同交卷時間視為重複略過，其餘新增', async () => {
    const p = await createPractice('exam');
    await insertExamSubmission(p.id, payload('s1', '2026-11-20T01:10:00.000Z', 13, [1, 2]));
    const res = await importSubmissions(p.id, [
      payload('s1', '2026-11-20T01:10:00.000Z', 13, [1, 2]), // 重複
      payload('s1', '2026-11-20T01:30:00.000Z', 20, [1, 2, 3]),
      payload('s3', '2026-11-20T01:30:00.000Z', 0, [], '03'),
    ]);

    expect(res).toEqual({ inserted: 2, skipped: 1 });

    const list = await listSubmissions(p.id);

    expect(list.map(s => [s.studentKey, s.latest.attemptNo])).toEqual([['s1', 2], ['s3', 1]]);
  });

  it('listSimPractices：只列自己的，附學生數與筆數', async () => {
    const p = await createPractice('exam', 'owner_list');
    await createPractice('exam', 'owner_other');
    await insertExamSubmission(p.id, payload('s1', '2026-11-20T01:10:00.000Z', 0, []));
    await insertExamSubmission(p.id, payload('s1', '2026-11-20T01:20:00.000Z', 0, []));
    await insertExamSubmission(p.id, payload('s2', '2026-11-20T01:30:00.000Z', 0, []));

    const list = await listSimPractices('owner_list');

    expect(list).toHaveLength(1);
    expect(list[0]!.studentCount).toBe(2);
    expect(list[0]!.submissionCount).toBe(3);
    expect(list[0]!.lastSubmittedAt?.toISOString()).toBe('2026-11-20T01:30:00.000Z');
  });
});
