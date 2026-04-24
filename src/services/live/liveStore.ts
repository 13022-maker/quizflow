// Live Mode 統一資料存取層：把 DB query 集中在此，API Route / Server Action 呼叫即可。

import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  liveAnswerSchema,
  liveGameSchema,
  livePlayerSchema,
  questionSchema,
} from '@/models/Schema';

import { publishTick } from './ablyServer';
import { calcLiveScore, gradeAnswer, isLiveSupportedType } from './scoring';
import type {
  LiveAnswerStat,
  LiveHostState,
  LivePlayerState,
  LivePlayerSummary,
  LiveQuestionForHost,
  LiveQuestionForPlayer,
} from './types';

// submit 容忍：學生送答比 questionEndsAt 多最多 TOLERANCE_MS 視為 in-window
// 用意是緩衝網路 latency，避免最後一秒按下卻被誤判 expired
const SUBMIT_TOLERANCE_MS = 1000;

// 取得某 game 的題目清單（依 position 排序，只含支援的三種題型）
export async function getLiveQuestions(quizId: number): Promise<LiveQuestionForHost[]> {
  const rows = await db
    .select({
      id: questionSchema.id,
      type: questionSchema.type,
      body: questionSchema.body,
      imageUrl: questionSchema.imageUrl,
      options: questionSchema.options,
      correctAnswers: questionSchema.correctAnswers,
      position: questionSchema.position,
    })
    .from(questionSchema)
    .where(eq(questionSchema.quizId, quizId))
    .orderBy(asc(questionSchema.position));

  return rows
    .filter(r => isLiveSupportedType(r.type))
    .map(r => ({
      id: r.id,
      type: r.type as 'single_choice' | 'multiple_choice' | 'true_false',
      body: r.body,
      imageUrl: r.imageUrl,
      options: (r.options ?? []) as { id: string; text: string }[],
      correctAnswers: (r.correctAnswers ?? []) as string[],
    }));
}

// 取得玩家清單（照分數高→低）
async function getPlayers(gameId: number): Promise<LivePlayerSummary[]> {
  const rows = await db
    .select({
      id: livePlayerSchema.id,
      nickname: livePlayerSchema.nickname,
      score: livePlayerSchema.score,
      correctCount: livePlayerSchema.correctCount,
    })
    .from(livePlayerSchema)
    .where(eq(livePlayerSchema.gameId, gameId))
    .orderBy(desc(livePlayerSchema.score));
  return rows;
}

// 當前題目的答題統計（每個選項被選次數；複選題每個 id 各計一次）
async function getAnswerStats(gameId: number, questionId: number): Promise<{
  stats: LiveAnswerStat[];
  answeredCount: number;
}> {
  const rows = await db
    .select({
      selectedOptionId: liveAnswerSchema.selectedOptionId,
    })
    .from(liveAnswerSchema)
    .where(and(
      eq(liveAnswerSchema.gameId, gameId),
      eq(liveAnswerSchema.questionId, questionId),
    ));

  const counter = new Map<string, number>();
  for (const r of rows) {
    const sel = r.selectedOptionId;
    if (sel === null || sel === undefined) {
      continue;
    }
    if (Array.isArray(sel)) {
      for (const id of sel) {
        counter.set(id, (counter.get(id) ?? 0) + 1);
      }
    } else {
      counter.set(sel, (counter.get(sel) ?? 0) + 1);
    }
  }

  const stats: LiveAnswerStat[] = Array.from(counter.entries()).map(([optionId, count]) => ({
    optionId,
    count,
  }));
  return { stats, answeredCount: rows.length };
}

// 取得老師主控台需要的完整 state
export async function getHostState(gameId: number): Promise<LiveHostState | null> {
  const [game] = await db
    .select()
    .from(liveGameSchema)
    .where(eq(liveGameSchema.id, gameId))
    .limit(1);
  if (!game) {
    return null;
  }

  const questions = await getLiveQuestions(game.quizId);
  const players = await getPlayers(game.id);

  const currentQuestion
    = game.currentQuestionIndex >= 0 && game.currentQuestionIndex < questions.length
      ? questions[game.currentQuestionIndex] ?? null
      : null;

  let answerStats: LiveAnswerStat[] = [];
  let answeredCount = 0;
  if (currentQuestion) {
    const s = await getAnswerStats(game.id, currentQuestion.id);
    answerStats = s.stats;
    answeredCount = s.answeredCount;
  }

  return {
    seq: game.seq,
    serverNow: Date.now(),
    quizVersion: game.quizVersion,
    game: {
      id: game.id,
      quizId: game.quizId,
      title: game.title,
      gamePin: game.gamePin,
      status: game.status,
      currentQuestionIndex: game.currentQuestionIndex,
      questionStartedAt: game.questionStartedAt ? game.questionStartedAt.toISOString() : null,
      questionEndsAt: game.questionEndsAt ? game.questionEndsAt.toISOString() : null,
      questionDuration: game.questionDuration,
      totalQuestions: questions.length,
    },
    players,
    currentQuestion,
    answerStats,
    answeredCount,
  };
}

// 取得學生端需要的 state（不含正解；僅 showing_result 回正解）
export async function getPlayerState(
  gameId: number,
  playerId: number,
): Promise<LivePlayerState | null> {
  const [game] = await db
    .select()
    .from(liveGameSchema)
    .where(eq(liveGameSchema.id, gameId))
    .limit(1);
  if (!game) {
    return null;
  }

  const [me] = await db
    .select()
    .from(livePlayerSchema)
    .where(and(
      eq(livePlayerSchema.id, playerId),
      eq(livePlayerSchema.gameId, gameId),
    ))
    .limit(1);
  if (!me) {
    return null;
  }

  const questions = await getLiveQuestions(game.quizId);
  const current
    = game.currentQuestionIndex >= 0 && game.currentQuestionIndex < questions.length
      ? questions[game.currentQuestionIndex] ?? null
      : null;

  const players = await getPlayers(game.id);
  const rank = players.findIndex(p => p.id === me.id) + 1;

  let currentQuestion: LiveQuestionForPlayer | null = null;
  if (current) {
    currentQuestion = {
      id: current.id,
      type: current.type,
      body: current.body,
      imageUrl: current.imageUrl,
      options: current.options,
    };
  }

  // 我在當前題的作答（如果有）
  let myAnswer: LivePlayerState['myAnswer'] = null;
  if (current) {
    const [ans] = await db
      .select({
        selectedOptionId: liveAnswerSchema.selectedOptionId,
        isCorrect: liveAnswerSchema.isCorrect,
        score: liveAnswerSchema.score,
      })
      .from(liveAnswerSchema)
      .where(and(
        eq(liveAnswerSchema.gameId, game.id),
        eq(liveAnswerSchema.playerId, me.id),
        eq(liveAnswerSchema.questionId, current.id),
      ))
      .limit(1);
    if (ans) {
      myAnswer = {
        selectedOptionId: ans.selectedOptionId ?? null,
        isCorrect: ans.isCorrect,
        score: ans.score,
      };
    }
  }

  // showing_result 階段才回正解 + stats
  let lastResult: LivePlayerState['lastResult'] = null;
  if (game.status === 'showing_result' && current) {
    const s = await getAnswerStats(game.id, current.id);
    lastResult = {
      correctAnswers: current.correctAnswers,
      answerStats: s.stats,
    };
  }

  // finished 階段回完整排行
  const leaderboard = game.status === 'finished' ? players : [];

  return {
    seq: game.seq,
    serverNow: Date.now(),
    quizVersion: game.quizVersion,
    game: {
      id: game.id,
      title: game.title,
      status: game.status,
      currentQuestionIndex: game.currentQuestionIndex,
      questionStartedAt: game.questionStartedAt ? game.questionStartedAt.toISOString() : null,
      questionEndsAt: game.questionEndsAt ? game.questionEndsAt.toISOString() : null,
      questionDuration: game.questionDuration,
      totalQuestions: questions.length,
    },
    me: {
      id: me.id,
      nickname: me.nickname,
      score: me.score,
      correctCount: me.correctCount,
      rank,
    },
    currentQuestion,
    myAnswer,
    lastResult,
    leaderboard,
  };
}

/**
 * 學生提交答案：server 端 grade + 計分 + 累加分數，atomic 寫入。
 * 回傳 { isCorrect, score }，若已作答（conflict）則回傳既有紀錄。
 */
export async function recordAnswer(params: {
  gameId: number;
  playerId: number;
  questionId: number;
  selectedOptionId: string | string[];
}): Promise<
  | { ok: true; isCorrect: boolean; score: number }
  | { ok: false; error: string; status?: number }
  > {
  const { gameId, playerId, questionId, selectedOptionId } = params;

  // 撈 game + 題目，驗證狀態
  const [game] = await db
    .select()
    .from(liveGameSchema)
    .where(eq(liveGameSchema.id, gameId))
    .limit(1);
  if (!game) {
    return { ok: false, error: 'GAME_NOT_FOUND', status: 404 };
  }
  // 嚴格 phase 檢查：只有 active (playing) 才能送答
  // locked / showing_result / finished 一律拒絕（即使 +1s 容忍也不行）
  if (game.status !== 'playing') {
    return { ok: false, error: 'LOCKED', status: 409 };
  }

  const [question] = await db
    .select()
    .from(questionSchema)
    .where(eq(questionSchema.id, questionId))
    .limit(1);
  if (!question || question.quizId !== game.quizId) {
    return { ok: false, error: 'QUESTION_NOT_FOUND', status: 404 };
  }
  if (!isLiveSupportedType(question.type)) {
    return { ok: false, error: 'UNSUPPORTED_TYPE', status: 400 };
  }

  // 確認這題是「當前題」（防 race：student 看到舊題就提交、teacher 已切下一題）
  const questions = await getLiveQuestions(game.quizId);
  const currentIdx = game.currentQuestionIndex;
  const currentQuestion = questions[currentIdx];
  if (!currentQuestion || currentQuestion.id !== questionId) {
    return { ok: false, error: 'QUESTION_MISMATCH', status: 409 };
  }

  // 絕對時間（endsAt）檢查：以 server 端 questionEndsAt 為權威
  // SUBMIT_TOLERANCE_MS 容忍網路 latency；超過直接 expired
  const startedAtMs = game.questionStartedAt ? game.questionStartedAt.getTime() : 0;
  const endsAtMs = game.questionEndsAt
    ? game.questionEndsAt.getTime()
    : startedAtMs + game.questionDuration * 1000;
  const nowMs = Date.now();
  const durationMs = game.questionDuration * 1000;

  if (!startedAtMs || nowMs > endsAtMs + SUBMIT_TOLERANCE_MS) {
    return { ok: false, error: 'EXPIRED', status: 409 };
  }

  // responseMs 由 server 計算（不信任 client 時鐘，防竄改瀏覽器時鐘拉分）
  const elapsed = Math.max(0, nowMs - startedAtMs);
  const responseMs = Math.min(elapsed, durationMs);

  // 已作答則直接回傳既有紀錄（防重複送分）
  const [existing] = await db
    .select()
    .from(liveAnswerSchema)
    .where(and(
      eq(liveAnswerSchema.playerId, playerId),
      eq(liveAnswerSchema.questionId, questionId),
    ))
    .limit(1);
  if (existing) {
    return { ok: true, isCorrect: existing.isCorrect, score: existing.score };
  }

  const isCorrect = gradeAnswer(question.type, question.correctAnswers, selectedOptionId);
  const score = calcLiveScore(isCorrect, responseMs, durationMs);

  // 寫入答題紀錄；同時累加 player 分數
  try {
    await db.insert(liveAnswerSchema).values({
      gameId,
      playerId,
      questionId,
      selectedOptionId,
      isCorrect,
      responseTimeMs: responseMs,
      score,
    });
  } catch {
    // 極少見的 race condition（unique index）：查既有回傳
    const [again] = await db
      .select()
      .from(liveAnswerSchema)
      .where(and(
        eq(liveAnswerSchema.playerId, playerId),
        eq(liveAnswerSchema.questionId, questionId),
      ))
      .limit(1);
    if (again) {
      return { ok: true, isCorrect: again.isCorrect, score: again.score };
    }
    return { ok: false, error: 'INSERT_FAILED', status: 500 };
  }

  await db
    .update(livePlayerSchema)
    .set({
      score: sql`${livePlayerSchema.score} + ${score}`,
      correctCount: sql`${livePlayerSchema.correctCount} + ${isCorrect ? 1 : 0}`,
    })
    .where(eq(livePlayerSchema.id, playerId));

  // 答題本身 +1 seq，讓 host / 其他 player 透過 seq 驅動 re-fetch
  const [bumped] = await db
    .update(liveGameSchema)
    .set({ seq: sql`${liveGameSchema.seq} + 1` })
    .where(eq(liveGameSchema.id, gameId))
    .returning();

  // 通知 host（看 answeredCount/stats 更新）與其他 player（排名可能變動）
  await publishTick(gameId, bumped?.seq);
  return { ok: true, isCorrect, score };
}

/**
 * 自癒 lock：當倒數結束（now > questionEndsAt）但 phase 還停在 'playing'，
 * atomic 切到 'locked'。第一個觸發 tick 的 client 會贏，其餘 client 收到 changed=false。
 *
 * 用 SQL `WHERE status='playing' AND question_ends_at <= NOW()` 確保 race-safe。
 */
export async function tickLockExpired(
  gameId: number,
): Promise<{ changed: boolean; seq: number | null }> {
  const [updated] = await db
    .update(liveGameSchema)
    .set({
      status: 'locked',
      seq: sql`${liveGameSchema.seq} + 1`,
    })
    .where(and(
      eq(liveGameSchema.id, gameId),
      eq(liveGameSchema.status, 'playing'),
      lte(liveGameSchema.questionEndsAt, sql`NOW()`),
    ))
    .returning();

  if (!updated) {
    return { changed: false, seq: null };
  }
  await publishTick(gameId, updated.seq);
  return { changed: true, seq: updated.seq };
}

// Player 透過 token 查 id（學生 API 身分驗證）
export async function verifyPlayerToken(
  gameId: number,
  playerToken: string,
): Promise<{ playerId: number } | null> {
  const [row] = await db
    .select({ id: livePlayerSchema.id })
    .from(livePlayerSchema)
    .where(and(
      eq(livePlayerSchema.gameId, gameId),
      eq(livePlayerSchema.playerToken, playerToken),
    ))
    .limit(1);
  return row ? { playerId: row.id } : null;
}

// 以 pin 查 game（含是否已結束）
export async function findGameByPin(pin: string): Promise<
  | { id: number; quizId: number; status: string; endedAt: Date | null }
  | null
> {
  const [row] = await db
    .select({
      id: liveGameSchema.id,
      quizId: liveGameSchema.quizId,
      status: liveGameSchema.status,
      endedAt: liveGameSchema.endedAt,
    })
    .from(liveGameSchema)
    .where(eq(liveGameSchema.gamePin, pin))
    .limit(1);
  return row ?? null;
}

// 同場暱稱是否已被使用（unique index 做最終防線，這邊做友善訊息）
export async function isNicknameTaken(gameId: number, nickname: string): Promise<boolean> {
  const [row] = await db
    .select({ id: livePlayerSchema.id })
    .from(livePlayerSchema)
    .where(and(
      eq(livePlayerSchema.gameId, gameId),
      eq(livePlayerSchema.nickname, nickname),
    ))
    .limit(1);
  return !!row;
}

// 取得一個 orgId 底下的 games（辦法是 quizzes -> games；若之後需要列表頁可用）
export async function listGamesByOrg(orgId: string, quizIds: number[]) {
  if (quizIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(liveGameSchema)
    .where(and(
      eq(liveGameSchema.hostOrgId, orgId),
      inArray(liveGameSchema.quizId, quizIds),
    ));
}
