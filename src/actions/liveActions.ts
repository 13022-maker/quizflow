'use server';

import { auth } from '@clerk/nextjs/server';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import {
  liveGameSchema,
  questionSchema,
  quizSchema,
} from '@/models/Schema';
import { publishTick } from '@/services/live/ablyServer';
import { isLiveSupportedType } from '@/services/live/scoring';
import { validSourcesFor } from '@/services/live/stateMachine';
import type { LiveGameStatus } from '@/services/live/types';

// 倒數 buffer：學生端收到推題後有 BUFFER_MS 的緩衝顯示「3, 2, 1」再開始計時
// 設計同步優化文件 §4：startsAt = now + BUFFER_MS, endsAt = startsAt + duration
const BUFFER_MS = 2000;

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
    const name = err instanceof Error ? err.name : 'UnknownError';
    const detail = err instanceof Error ? err.message : String(err);
    const debugStack = err instanceof Error ? err.stack?.split('\n').slice(0, 8).join(' | ') : undefined;
    console.error('[createLiveGame] unexpected error:', err);
    return { error: `Live Mode 建立失敗：[${name}] ${detail}`, debugStack };
  }
}

// 統一的 atomic 推進工具：在合法 source phase 才寫入，並 +1 seq；失敗回 null
async function transitionGame(params: {
  gameId: number;
  orgId: string;
  to: LiveGameStatus;
  set?: Partial<typeof liveGameSchema.$inferInsert>;
}): Promise<{ status: LiveGameStatus; seq: number } | null> {
  const sources = validSourcesFor(params.to);
  if (sources.length === 0) {
    return null;
  }

  const [updated] = await db
    .update(liveGameSchema)
    .set({
      ...(params.set ?? {}),
      status: params.to,
      seq: sql`${liveGameSchema.seq} + 1`,
    })
    .where(and(
      eq(liveGameSchema.id, params.gameId),
      eq(liveGameSchema.hostOrgId, params.orgId),
      inArray(liveGameSchema.status, sources as LiveGameStatus[]),
    ))
    .returning();

  if (!updated) {
    return null;
  }
  return { status: updated.status, seq: updated.seq };
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

  const now = Date.now();
  const startsAt = new Date(now + BUFFER_MS);
  const endsAt = new Date(now + BUFFER_MS + game.questionDuration * 1000);

  const updated = await transitionGame({
    gameId,
    orgId,
    to: 'playing',
    set: {
      currentQuestionIndex: 0,
      questionStartedAt: startsAt,
      questionEndsAt: endsAt,
    },
  });
  if (!updated) {
    return { error: 'INVALID_TRANSITION' };
  }

  await publishTick(gameId, updated.seq);
  return { ok: true as const };
}

export async function showResult(gameId: number) {
  const { orgId } = await auth();
  if (!orgId) {
    return { error: 'Unauthorized' as const };
  }
  // playing → showing_result（手動提早結束）或 locked → showing_result（自癒之後 reveal）
  const updated = await transitionGame({ gameId, orgId, to: 'showing_result' });
  if (!updated) {
    return { error: 'INVALID_TRANSITION' };
  }

  await publishTick(gameId, updated.seq);
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
    const updated = await transitionGame({
      gameId,
      orgId,
      to: 'finished',
      set: { endedAt: new Date() },
    });
    if (!updated) {
      return { error: 'INVALID_TRANSITION' };
    }
    await publishTick(gameId, updated.seq);
    return { ok: true as const, finished: true };
  }

  const now = Date.now();
  const startsAt = new Date(now + BUFFER_MS);
  const endsAt = new Date(now + BUFFER_MS + game.questionDuration * 1000);

  const updated = await transitionGame({
    gameId,
    orgId,
    to: 'playing',
    set: {
      currentQuestionIndex: nextIdx,
      questionStartedAt: startsAt,
      questionEndsAt: endsAt,
    },
  });
  if (!updated) {
    return { error: 'INVALID_TRANSITION' };
  }

  await publishTick(gameId, updated.seq);
  return { ok: true as const, finished: false };
}

export async function endGame(gameId: number) {
  const { orgId } = await auth();
  if (!orgId) {
    return { error: 'Unauthorized' as const };
  }
  const updated = await transitionGame({
    gameId,
    orgId,
    to: 'finished',
    set: { endedAt: new Date() },
  });
  if (!updated) {
    return { error: 'INVALID_TRANSITION' };
  }

  await publishTick(gameId, updated.seq);
  return { ok: true as const };
}
