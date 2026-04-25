'use server';

import { auth } from '@clerk/nextjs/server';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import {
  liveGameSchema,
  questionSchema,
  quizSchema,
} from '@/models/Schema';
import { publishTick } from '@/services/live/ablyServer';
import { isLiveSupportedType } from '@/services/live/scoring';

// 自動推進等待時間（秒）：題目倒數結束後緩衝、答案揭示停留
const PLAY_PHASE_BUFFER_SEC = 5;
const RESULT_PHASE_DURATION_SEC = 5;

// 註：'use server' 檔案內 Drizzle 的 sql 模板（含 ${param} 參數）寫入會被
// Next.js Server Action 編譯器吃掉，欄位變 null。改用 JS Date 物件就 OK
// （跟原本 questionStartedAt: new Date() 同 pattern）。

// 生成 6 碼大寫英數 game pin（與 quizActions 同邏輯）
function generatePin(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function generateUniquePin(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const pin = generatePin();
    const [existing] = await db
      .select({ id: liveGameSchema.id })
      .from(liveGameSchema)
      .where(eq(liveGameSchema.gamePin, pin))
      .limit(1);
    if (!existing) {
      return pin;
    }
  }
  return generatePin() + Math.random().toString(36).slice(2, 3).toUpperCase();
}

// 驗證 game 屬於當前使用者
async function loadOwnedGame(gameId: number, userId: string) {
  const [game] = await db
    .select()
    .from(liveGameSchema)
    .where(and(eq(liveGameSchema.id, gameId), eq(liveGameSchema.hostUserId, userId)))
    .limit(1);
  return game ?? null;
}

const CreateLiveGameSchema = z.object({
  quizId: z.number().int().positive(),
  questionDuration: z.number().int().min(5).max(120).optional(),
});
export type CreateLiveGameInput = z.infer<typeof CreateLiveGameSchema>;

export async function createLiveGame(input: CreateLiveGameInput) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return { error: 'Unauthorized' as const };
    }

    const parsed = CreateLiveGameSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.errors[0]?.message ?? '資料格式錯誤' };
    }

    const [quiz] = await db
      .select({
        id: quizSchema.id,
        title: quizSchema.title,
        ownerId: quizSchema.ownerId,
        status: quizSchema.status,
      })
      .from(quizSchema)
      .where(eq(quizSchema.id, parsed.data.quizId))
      .limit(1);

    if (!quiz || quiz.ownerId !== userId) {
      return { error: '找不到測驗或沒有權限' };
    }
    if (quiz.status !== 'published') {
      return { error: '請先發佈測驗才能開始 Live Mode' };
    }

    // 確認至少有一題支援題型
    const questions = await db
      .select({ type: questionSchema.type })
      .from(questionSchema)
      .where(eq(questionSchema.quizId, quiz.id))
      .orderBy(asc(questionSchema.position));
    const hasSupported = questions.some(q => isLiveSupportedType(q.type));
    if (!hasSupported) {
      return { error: '此測驗沒有可用於 Live Mode 的題目（僅支援單選、多選、是非題）' };
    }

    const gamePin = await generateUniquePin();

    const [inserted] = await db
      .insert(liveGameSchema)
      .values({
        quizId: quiz.id,
        hostUserId: userId,
        title: quiz.title,
        gamePin,
        questionDuration: parsed.data.questionDuration ?? 20,
      })
      .returning();

    if (!inserted) {
      return { error: '建立 Live 遊戲失敗' };
    }

    return { ok: true as const, gameId: inserted.id, gamePin: inserted.gamePin };
  } catch (err) {
    // DB 層 exception（例如 live_game 表不存在：migration 未跑）
    // 包起來避免 client 收到 unhandled rejection 觸發「Application error」白屏。
    // 第一句訊息給使用者看，後面附原 message 供除錯。
    const name = err instanceof Error ? err.name : 'UnknownError';
    const detail = err instanceof Error ? err.message : String(err);
    // DEBUG：暫時把 stack 前 8 行帶回 client，定位後拔掉
    const debugStack = err instanceof Error ? err.stack?.split('\n').slice(0, 8).join(' | ') : undefined;
    console.error('[createLiveGame] unexpected error:', err);
    return { error: `Live Mode 建立失敗：[${name}] ${detail}`, debugStack };
  }
}

export async function startGame(gameId: number) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }
  const game = await loadOwnedGame(gameId, userId);
  if (!game) {
    return { error: 'GAME_NOT_FOUND' };
  }
  if (game.status !== 'waiting') {
    return { error: 'ALREADY_STARTED' };
  }

  // 用 JS Date：跟 questionStartedAt 同 pattern，可靠寫入 timestamp 欄位
  const now = new Date();
  await db
    .update(liveGameSchema)
    .set({
      status: 'playing',
      currentQuestionIndex: 0,
      questionStartedAt: now,
      nextTransitionAt: new Date(now.getTime() + (game.questionDuration + PLAY_PHASE_BUFFER_SEC) * 1000),
    })
    .where(eq(liveGameSchema.id, game.id));

  await publishTick(game.id);
  return { ok: true as const };
}

export async function showResult(gameId: number) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }
  const game = await loadOwnedGame(gameId, userId);
  if (!game) {
    return { error: 'GAME_NOT_FOUND' };
  }
  if (game.status !== 'playing') {
    return { error: 'NOT_PLAYING' };
  }

  await db
    .update(liveGameSchema)
    .set({
      status: 'showing_result',
      nextTransitionAt: new Date(Date.now() + RESULT_PHASE_DURATION_SEC * 1000),
    })
    .where(eq(liveGameSchema.id, game.id));

  await publishTick(game.id);
  return { ok: true as const };
}

export async function nextQuestion(gameId: number) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }
  const game = await loadOwnedGame(gameId, userId);
  if (!game) {
    return { error: 'GAME_NOT_FOUND' };
  }

  // 取支援題型數量
  const rows = await db
    .select({ type: questionSchema.type })
    .from(questionSchema)
    .where(eq(questionSchema.quizId, game.quizId))
    .orderBy(asc(questionSchema.position));
  const supportedCount = rows.filter(r => isLiveSupportedType(r.type)).length;

  const nextIdx = game.currentQuestionIndex + 1;
  if (nextIdx >= supportedCount) {
    // 已經是最後一題 → 結束
    await db
      .update(liveGameSchema)
      .set({ status: 'finished', endedAt: new Date(), nextTransitionAt: null })
      .where(eq(liveGameSchema.id, game.id));
    await publishTick(game.id);
    return { ok: true as const, finished: true };
  }

  const nowQ = new Date();
  await db
    .update(liveGameSchema)
    .set({
      status: 'playing',
      currentQuestionIndex: nextIdx,
      questionStartedAt: nowQ,
      nextTransitionAt: new Date(nowQ.getTime() + (game.questionDuration + PLAY_PHASE_BUFFER_SEC) * 1000),
    })
    .where(eq(liveGameSchema.id, game.id));

  await publishTick(game.id);
  return { ok: true as const, finished: false };
}

export async function endGame(gameId: number) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }
  const game = await loadOwnedGame(gameId, userId);
  if (!game) {
    return { error: 'GAME_NOT_FOUND' };
  }

  await db
    .update(liveGameSchema)
    .set({ status: 'finished', endedAt: new Date(), nextTransitionAt: null })
    .where(eq(liveGameSchema.id, game.id));

  await publishTick(game.id);
  return { ok: true as const };
}
