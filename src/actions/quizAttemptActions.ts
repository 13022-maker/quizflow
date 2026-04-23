'use server';

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { quizSchema, responseSchema } from '@/models/Schema';
import { publishToChannel } from '@/services/live/ablyServer';

// 即時監考 / 儀表板用的 attempt flow：
// 1. 學生進 QuizTaker → startQuizAttempt 建 in_progress row + 回 token
// 2. 作答中 → POST /api/quiz/[id]/progress 更新進度 + leaveCount
// 3. submit → submitQuizResponse 把 status 改 submitted + 寫 answer + 計分
//
// 只對 quiz.preventLeave=true 的測驗啟用；其他測驗仍走舊匿名流程（submit 時才建 row）

const StartAttemptSchema = z.object({
  accessCode: z.string().min(1).max(32),
  studentName: z.string().max(100).optional(),
  studentEmail: z.string().email().max(200).optional(),
});

export type StartAttemptInput = z.infer<typeof StartAttemptSchema>;

export type StartAttemptResult
  = | { ok: true; quizId: number; responseId: number; studentToken: string }
  | { ok: false; error: string };

// 進 QuizTaker 頁面時呼叫：建空 response row + 回傳 studentToken（client 存 localStorage）
// 只在 quiz.preventLeave=true 時呼叫（client 端由 QuizTaker 判斷）
export async function startQuizAttempt(data: StartAttemptInput): Promise<StartAttemptResult> {
  const parsed = StartAttemptSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? '格式錯誤' };
  }

  const now = new Date();

  // 查 accessCode 對應的 quiz；檢查狀態 + 到期
  const [quiz] = await db
    .select({
      id: quizSchema.id,
      status: quizSchema.status,
      expiresAt: quizSchema.expiresAt,
    })
    .from(quizSchema)
    .where(eq(quizSchema.accessCode, parsed.data.accessCode))
    .limit(1);

  if (!quiz) {
    return { ok: false, error: '找不到測驗' };
  }
  if (quiz.status !== 'published') {
    return { ok: false, error: '測驗尚未發佈' };
  }
  if (quiz.expiresAt && new Date(quiz.expiresAt).getTime() < now.getTime()) {
    return { ok: false, error: '測驗已過期' };
  }

  const studentToken = nanoid(24);

  const [inserted] = await db
    .insert(responseSchema)
    .values({
      quizId: quiz.id,
      studentName: parsed.data.studentName || null,
      studentEmail: parsed.data.studentEmail || null,
      studentToken,
      status: 'in_progress',
      startedAt: now,
      // 預留欄位：submit 時才寫入實際分數
      score: null,
      totalPoints: null,
      leaveCount: 0,
      lastAnsweredQuestionIndex: -1,
    })
    .returning();

  if (!inserted) {
    return { ok: false, error: '建立作答失敗，請重試' };
  }

  // 通知老師監考牆有新學生加入
  await publishToChannel(`quiz-proctor:${quiz.id}`, 'tick', { ts: Date.now() });

  return {
    ok: true,
    quizId: quiz.id,
    responseId: inserted.id,
    studentToken,
  };
}

// 工具：依 studentToken 查 response row（含基本驗證）
export async function getAttemptByToken(
  quizId: number,
  studentToken: string,
): Promise<{ responseId: number; status: 'in_progress' | 'submitted' } | null> {
  const [row] = await db
    .select({
      id: responseSchema.id,
      status: responseSchema.status,
    })
    .from(responseSchema)
    .where(and(
      eq(responseSchema.quizId, quizId),
      eq(responseSchema.studentToken, studentToken),
    ))
    .limit(1);
  return row ? { responseId: row.id, status: row.status } : null;
}

// TODO(cleanup): 放棄作答超過 6h 的 in_progress row 定期清理，待排程 cron 接手
