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
import { isLiveSupportedType } from '@/services/live/scoring';

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

// 驗證 game 屬於當前 org
async function loadOwnedGame(gameId: number, orgId: string) {
  const [game] = await db
    .select()
    .from(liveGameSchema)
    .where(and(eq(liveGameSchema.id, gameId), eq(liveGameSchema.hostOrgId, orgId)))
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
    const { orgId, userId } = await auth();
    if (!orgId || !userId) {
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

    if (!quiz || quiz.ownerId !== orgId) {
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
        hostOrgId: orgId,
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
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[createLiveGame] unexpected error:', err);
    return { error: `Live Mode 建立失敗：${detail}` };
  }
}

export async function startGame(gameId: number) {
  const { orgId } = await auth();
  if (!orgId) {
    return { error: 'Unauthorized' as const };
  }
  const game = await loadOwnedGame(gameId, orgId);
  if (!game) {
    return { error: 'GAME_NOT_FOUND' };
  }
  if (game.status !== 'waiting') {
    return { error: 'ALREADY_STARTED' };
  }

  await db
    .update(liveGameSchema)
    .set({
      status: 'playing',
      currentQuestionIndex: 0,
      questionStartedAt: new Date(),
    })
    .where(eq(liveGameSchema.id, game.id));

  return { ok: true as const };
}

export async function showResult(gameId: number) {
  const { orgId } = await auth();
  if (!orgId) {
    return { error: 'Unauthorized' as const };
  }
  const game = await loadOwnedGame(gameId, orgId);
  if (!game) {
    return { error: 'GAME_NOT_FOUND' };
  }
  if (game.status !== 'playing') {
    return { error: 'NOT_PLAYING' };
  }

  await db
    .update(liveGameSchema)
    .set({ status: 'showing_result' })
    .where(eq(liveGameSchema.id, game.id));

  return { ok: true as const };
}

export async function nextQuestion(gameId: number) {
  const { orgId } = await auth();
  if (!orgId) {
    return { error: 'Unauthorized' as const };
  }
  const game = await loadOwnedGame(gameId, orgId);
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
      .set({ status: 'finished', endedAt: new Date() })
      .where(eq(liveGameSchema.id, game.id));
    return { ok: true as const, finished: true };
  }

  await db
    .update(liveGameSchema)
    .set({
      status: 'playing',
      currentQuestionIndex: nextIdx,
      questionStartedAt: new Date(),
    })
    .where(eq(liveGameSchema.id, game.id));

  return { ok: true as const, finished: false };
}

export async function endGame(gameId: number) {
  const { orgId } = await auth();
  if (!orgId) {
    return { error: 'Unauthorized' as const };
  }
  const game = await loadOwnedGame(gameId, orgId);
  if (!game) {
    return { error: 'GAME_NOT_FOUND' };
  }

  await db
    .update(liveGameSchema)
    .set({ status: 'finished', endedAt: new Date() })
    .where(eq(liveGameSchema.id, game.id));

  return { ok: true as const };
}
