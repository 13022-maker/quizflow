'use server';

/**
 * 實作模擬（hdfix3）Server Actions — 教師端
 * 老師建立「實作模擬」（練習 / 測驗模式）→ 取得 8 碼分享連結發給學生；
 * 學生作答與交卷走公開 API（/api/sim/[code]/*），不經過這裡。
 */
import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSimPracticeForOwner, importSubmissions } from '@/libs/sim/dao';
import { decodeSimCodeDetailed, sanitizeSimSpec } from '@/libs/sim/result';
import { simPracticeSchema } from '@/models/Schema';

const createSimPracticeSchema = z.object({
  title: z.string().trim().min(1, '請輸入名稱').max(100, '名稱最多 100 字'),
  mode: z.enum(['practice', 'exam']),
  timeLimitMin: z.number().int().min(1, '限時至少 1 分鐘').max(600, '限時最多 600 分鐘').nullable().optional(),
  spec: z.unknown().optional(),
});

export type CreateSimPracticeInput = {
  title: string;
  mode: 'practice' | 'exam';
  timeLimitMin?: number | null; // null / 省略 = 不限時
  spec?: Record<string, unknown> | null; // 監評指定內容覆蓋值（hdfix3 DEF 欄位）；null = 用預設
};

/** 建立實作模擬：分享碼用 8 碼 nanoid（防循序猜測）。不 redirect，由 client 依回傳 id 導頁。 */
export async function createSimPractice(
  input: CreateSimPracticeInput,
): Promise<{ id: number; accessCode: string } | { error: string }> {
  const { userId } = await auth();
  if (!userId) {
    return { error: '請先登入' };
  }

  const parsed = createSimPracticeSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '輸入格式錯誤' };
  }
  const spec = sanitizeSimSpec(parsed.data.spec);
  if (!spec.ok) {
    return { error: spec.error };
  }

  const [practice] = await db
    .insert(simPracticeSchema)
    .values({
      ownerId: userId,
      simKind: 'hdfix3',
      mode: parsed.data.mode,
      title: parsed.data.title,
      accessCode: nanoid(8),
      spec: spec.value,
      timeLimitMin: parsed.data.timeLimitMin ?? null,
    })
    .returning();

  revalidatePath('/dashboard/sims');
  return { id: practice!.id, accessCode: practice!.accessCode };
}

/** 刪除實作模擬（連同所有成績，schema 已設 onDelete: cascade）；只能刪自己的 */
export async function deleteSimPractice(practiceId: number): Promise<{ ok: true } | { error: string }> {
  const { userId } = await auth();
  if (!userId) {
    return { error: '請先登入' };
  }
  const id = z.number().int().positive().safeParse(practiceId);
  if (!id.success) {
    return { error: '參數錯誤' };
  }

  await db
    .delete(simPracticeSchema)
    .where(and(eq(simPracticeSchema.id, id.data), eq(simPracticeSchema.ownerId, userId)));

  revalidatePath('/dashboard/sims');
  return { ok: true };
}

const importSchema = z.object({
  practiceId: z.number().int().positive(),
  text: z.string().min(1, '請貼上成績碼').max(500_000, '內容太長，請分批匯入'),
});

/**
 * 匯入離線成績碼（`HDFIX3:` base64 JSON，可夾在聊天紀錄中；也接受原始 JSON / JSON 陣列）。
 * 每筆分數由 server 重算。回傳成功寫入 / 重複略過筆數與無法解析的錯誤訊息。
 */
export async function importSimResults(
  practiceId: number,
  text: string,
): Promise<{ inserted: number; skipped: number; errors: string[] } | { error: string }> {
  const { userId } = await auth();
  if (!userId) {
    return { error: '請先登入' };
  }
  const parsed = importSchema.safeParse({ practiceId, text });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '輸入格式錯誤' };
  }

  const practice = await getSimPracticeForOwner(parsed.data.practiceId, userId);
  if (!practice) {
    return { error: '找不到這個實作模擬' };
  }

  const { results, errors } = decodeSimCodeDetailed(parsed.data.text);
  if (results.length === 0) {
    return { error: errors[0] ?? '找不到任何以 HDFIX3: 開頭的成績碼或 JSON' };
  }

  const { inserted, skipped } = await importSubmissions(practice.id, results);
  revalidatePath(`/dashboard/sims/${practice.id}`);
  return { inserted, skipped, errors };
}
