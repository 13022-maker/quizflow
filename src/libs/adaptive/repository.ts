/**
 * DrizzleAdaptiveRepository — 學生 BKT 狀態的 QuizFlow 資料庫實作
 * 一個「適性練習（practice）」一個 repository 實例，資料以 practice_id 隔離；
 * studentId（引擎概念）＝ studentKey（學號／座號，免登入、同一練習內唯一）。
 * displayName 由註冊 API 另行寫入（引擎的 StudentState 不含姓名，save 不碰它）。
 */
import { and, eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { adaptiveStudentStateSchema } from '@/models/Schema';

import type { StudentState, StudentStateRepository } from './engine';

/** DB 資料列 → 引擎的 StudentState（JSONB 普通物件/陣列 → Map/Set） */
function rowToState(row: typeof adaptiveStudentStateSchema.$inferSelect): StudentState {
  return {
    studentId: row.studentKey,
    knowledge: new Map(Object.entries(row.knowledge)),
    answeredItemIds: new Set(row.answeredItemIds),
  };
}

export class DrizzleAdaptiveRepository implements StudentStateRepository {
  constructor(private practiceId: number) {}

  async get(studentId: string): Promise<StudentState | undefined> {
    const rows = await db
      .select()
      .from(adaptiveStudentStateSchema)
      .where(
        and(
          eq(adaptiveStudentStateSchema.practiceId, this.practiceId),
          eq(adaptiveStudentStateSchema.studentKey, studentId),
        ),
      );
    const row = rows[0];
    return row ? rowToState(row) : undefined;
  }

  async save(state: StudentState): Promise<void> {
    const knowledge = Object.fromEntries(state.knowledge); // Map → JSONB 物件
    const answeredItemIds = [...state.answeredItemIds]; // Set → JSONB 陣列
    await db
      .insert(adaptiveStudentStateSchema)
      .values({
        practiceId: this.practiceId,
        studentKey: state.studentId,
        displayName: state.studentId, // 佔位；註冊 API 隨後以 setDisplayName 補真名
        knowledge,
        answeredItemIds,
      })
      .onConflictDoUpdate({
        target: [adaptiveStudentStateSchema.practiceId, adaptiveStudentStateSchema.studentKey],
        set: { knowledge, answeredItemIds, updatedAt: new Date() }, // 不覆寫 displayName
      });
  }

  async list(): Promise<StudentState[]> {
    const rows = await db
      .select()
      .from(adaptiveStudentStateSchema)
      .where(eq(adaptiveStudentStateSchema.practiceId, this.practiceId));
    return rows.map(rowToState);
  }

  /** 寫入學生姓名（首次註冊時），upsert 之後呼叫 */
  async setDisplayName(studentKey: string, displayName: string): Promise<void> {
    await db
      .update(adaptiveStudentStateSchema)
      .set({ displayName })
      .where(
        and(
          eq(adaptiveStudentStateSchema.practiceId, this.practiceId),
          eq(adaptiveStudentStateSchema.studentKey, studentKey),
        ),
      );
  }

  /** 學號 → 姓名 對照表（教師儀表板與事件 sink 用） */
  async getDisplayNames(): Promise<Map<string, string>> {
    const rows = await db
      .select({
        studentKey: adaptiveStudentStateSchema.studentKey,
        displayName: adaptiveStudentStateSchema.displayName,
      })
      .from(adaptiveStudentStateSchema)
      .where(eq(adaptiveStudentStateSchema.practiceId, this.practiceId));
    return new Map(rows.map(r => [r.studentKey, r.displayName]));
  }
}
