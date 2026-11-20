/**
 * 實作模擬（hdfix3）資料存取層：server 專用（import DB）。
 * 呼叫端負責驗證：學生 API 先 parseSimResult()，老師端先 auth() + owner 檢查。
 */
import { and, asc, count, countDistinct, desc, eq, lte, max } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { simPracticeSchema, simSubmissionSchema } from '@/models/Schema';

import type { SimResultPayload } from './types';

export type SimPractice = typeof simPracticeSchema.$inferSelect;
export type SimSubmission = typeof simSubmissionSchema.$inferSelect;

export type SimPracticeListItem = SimPractice & {
  studentCount: number; // 不重複學號數
  submissionCount: number; // 總筆數（含 exam 重考）
  lastSubmittedAt: Date | null;
};

export type SimStudentSubmissions = {
  studentKey: string;
  latest: SimSubmission; // attemptNo 最大的一筆
  history: SimSubmission[]; // 全部紀錄，attemptNo 由大到小（含 latest）
};

/** 學生端入口：以 8 碼分享碼查練習（找不到回 undefined） */
export async function getSimPracticeByCode(code: string): Promise<SimPractice | undefined> {
  if (!code || code.length > 32) {
    return undefined;
  }
  const [row] = await db.select().from(simPracticeSchema).where(eq(simPracticeSchema.accessCode, code)).limit(1);
  return row;
}

/** 老師端：只回傳自己擁有的練習（不是自己的視同不存在） */
export async function getSimPracticeForOwner(id: number, userId: string): Promise<SimPractice | undefined> {
  if (!Number.isInteger(id) || id <= 0) {
    return undefined;
  }
  const [row] = await db
    .select()
    .from(simPracticeSchema)
    .where(and(eq(simPracticeSchema.id, id), eq(simPracticeSchema.ownerId, userId)))
    .limit(1);
  return row;
}

/** 老師的實作模擬清單（新到舊），附人數統計 */
export async function listSimPractices(userId: string): Promise<SimPracticeListItem[]> {
  const practices = await db
    .select()
    .from(simPracticeSchema)
    .where(eq(simPracticeSchema.ownerId, userId))
    .orderBy(desc(simPracticeSchema.createdAt));
  if (practices.length === 0) {
    return [];
  }

  const stats = await db
    .select({
      practiceId: simSubmissionSchema.practiceId,
      studentCount: countDistinct(simSubmissionSchema.studentKey),
      submissionCount: count(),
      lastSubmittedAt: max(simSubmissionSchema.submittedAt),
    })
    .from(simSubmissionSchema)
    .innerJoin(simPracticeSchema, eq(simSubmissionSchema.practiceId, simPracticeSchema.id))
    .where(eq(simPracticeSchema.ownerId, userId))
    .groupBy(simSubmissionSchema.practiceId);
  const byId = new Map(stats.map(s => [s.practiceId, s]));

  return practices.map((p) => {
    const s = byId.get(p.id);
    return {
      ...p,
      studentCount: Number(s?.studentCount ?? 0),
      submissionCount: Number(s?.submissionCount ?? 0),
      lastSubmittedAt: s?.lastSubmittedAt ? new Date(s.lastSubmittedAt) : null,
    };
  });
}

/** 某練習所有成績，依學生分組（每學生最新一筆 + 歷史），依崗位、學號排序 */
export async function listSubmissions(practiceId: number): Promise<SimStudentSubmissions[]> {
  const rows = await db
    .select()
    .from(simSubmissionSchema)
    .where(eq(simSubmissionSchema.practiceId, practiceId))
    .orderBy(asc(simSubmissionSchema.studentKey), desc(simSubmissionSchema.attemptNo));

  const groups = new Map<string, SimSubmission[]>();
  for (const row of rows) {
    const list = groups.get(row.studentKey);
    if (list) {
      list.push(row);
    } else {
      groups.set(row.studentKey, [row]);
    }
  }

  return [...groups.entries()]
    .map(([studentKey, history]) => ({ studentKey, latest: history[0]!, history }))
    .sort((a, b) => a.latest.seat.localeCompare(b.latest.seat) || a.studentKey.localeCompare(b.studentKey));
}

function toValues(practiceId: number, p: SimResultPayload, attemptNo: number, isFinal: boolean) {
  return {
    practiceId,
    studentKey: p.sid,
    displayName: p.name,
    seat: p.seat,
    attemptNo,
    isFinal,
    startedAt: new Date(p.startedAt),
    submittedAt: new Date(p.submittedAt),
    durationSec: p.durationSec,
    score: p.score,
    items: p.items,
  };
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

/**
 * exam 交卷：新增一筆 attemptNo = 該生目前最大 + 1、isFinal = true。
 * 同一學生同時送兩次時撞 unique index → 重算 attemptNo 重試（最多 3 次）。
 * payload 必須已經過 parseSimResult（score 已由 server 重算）。
 */
export async function insertExamSubmission(practiceId: number, payload: SimResultPayload): Promise<SimSubmission> {
  for (let tries = 0; ; tries++) {
    const [cur] = await db
      .select({ maxNo: max(simSubmissionSchema.attemptNo) })
      .from(simSubmissionSchema)
      .where(and(eq(simSubmissionSchema.practiceId, practiceId), eq(simSubmissionSchema.studentKey, payload.sid)));
    const attemptNo = (cur?.maxNo ?? 0) + 1;
    try {
      const [row] = await db
        .insert(simSubmissionSchema)
        .values(toValues(practiceId, payload, attemptNo, true))
        .returning();
      return row!;
    } catch (err) {
      if (tries < 2 && isUniqueViolation(err)) {
        continue;
      }
      throw err;
    }
  }
}

/**
 * practice 進度：每位學生固定 attemptNo = 1、isFinal = false，upsert 最新進度。
 * 網路亂序時舊進度（submittedAt 較早）不會蓋掉新進度；此時回傳既有那筆。
 */
export async function upsertPracticeProgress(practiceId: number, payload: SimResultPayload): Promise<SimSubmission> {
  const values = toValues(practiceId, payload, 1, false);
  const [row] = await db
    .insert(simSubmissionSchema)
    .values(values)
    .onConflictDoUpdate({
      target: [simSubmissionSchema.practiceId, simSubmissionSchema.studentKey, simSubmissionSchema.attemptNo],
      set: {
        displayName: values.displayName,
        seat: values.seat,
        startedAt: values.startedAt,
        submittedAt: values.submittedAt,
        durationSec: values.durationSec,
        score: values.score,
        items: values.items,
      },
      setWhere: lteSubmittedAt(values.submittedAt),
    })
    .returning();
  if (row) {
    return row;
  }
  const [existing] = await db
    .select()
    .from(simSubmissionSchema)
    .where(
      and(
        eq(simSubmissionSchema.practiceId, practiceId),
        eq(simSubmissionSchema.studentKey, payload.sid),
        eq(simSubmissionSchema.attemptNo, 1),
      ),
    )
    .limit(1);
  return existing!;
}

function lteSubmittedAt(submittedAt: Date) {
  // 只有既有紀錄不比這次新時才覆寫
  return lte(simSubmissionSchema.submittedAt, submittedAt);
}

/**
 * 老師匯入離線成績碼（payloads 須已過 parseSimResult）：
 * - exam 練習：每筆新增一次交卷（attemptNo + 1）；同學號且同交卷時間的視為重複，略過。
 * - practice 練習：比照進度 upsert（較舊的不覆蓋）。
 */
export async function importSubmissions(
  practiceId: number,
  payloads: SimResultPayload[],
): Promise<{ inserted: number; skipped: number }> {
  const [practice] = await db
    .select({ mode: simPracticeSchema.mode })
    .from(simPracticeSchema)
    .where(eq(simPracticeSchema.id, practiceId))
    .limit(1);
  if (!practice) {
    throw new Error(`實作模擬不存在：${practiceId}`);
  }

  // 依交卷時間由舊到新寫入，attemptNo 才會跟時間順序一致
  const sorted = [...payloads].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  let inserted = 0;
  let skipped = 0;

  if (practice.mode === 'practice') {
    for (const p of sorted) {
      const row = await upsertPracticeProgress(practiceId, p);
      if (row.submittedAt.getTime() === new Date(p.submittedAt).getTime()) {
        inserted++;
      } else {
        skipped++;
      }
    }
    return { inserted, skipped };
  }

  const existing = await db
    .select({ studentKey: simSubmissionSchema.studentKey, submittedAt: simSubmissionSchema.submittedAt })
    .from(simSubmissionSchema)
    .where(eq(simSubmissionSchema.practiceId, practiceId));
  const seen = new Set(existing.map(e => `${e.studentKey}|${e.submittedAt.toISOString()}`));

  for (const p of sorted) {
    const key = `${p.sid}|${new Date(p.submittedAt).toISOString()}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    await insertExamSubmission(practiceId, p);
    seen.add(key);
    inserted++;
  }
  return { inserted, skipped };
}
