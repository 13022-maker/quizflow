// Live Mode「小組搶答」資料存取層：只負責讀寫 DB 與 optimistic lock，規則一律交給 buzzer.ts 的純函式。
//
// 時間：所有判定（看題倒數、作答逾時、搶答順序）都用 DB 時鐘。buzzedAt 是 DB 預設 now()，
// 其他時間欄位寫入「從 DB 讀回的 now」，避免多台 serverless instance 時鐘不同步。
//
// 注意：這支不是 'use server'。Server Action 檔內寫 timestamp 會被 Next.js 編譯器吃成 null
// （liveStore.ts 有記錄），所以搶答相關的時間欄位寫入一律放在這裡，Server Action 只做身分驗證後呼叫。

import { and, asc, eq, getTableColumns, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  liveBuzzSchema,
  liveGameSchema,
  livePlayerSchema,
  liveTeamSchema,
} from '@/models/Schema';

import { publishBoard, publishTick } from './ablyServer';
import {
  assignTeamsByCount,
  BUZZER_ANSWER_MS,
  BUZZER_READING_MS,
  type BuzzState,
  checkAnswerAllowed,
  checkBuzzAllowed,
  pickTeamForLateJoiner,
  planReconcile,
  scoreDeltaFor,
  sortBuzzes,
  teamNameFor,
} from './buzzer';
import { getGameQuestions } from './liveQuestions';
import { gradeAnswer } from './scoring';
import type {
  LiveBuzzEntryForHost,
  LiveBuzzerBoard,
  LiveBuzzerHostView,
  LiveBuzzerPlayerStat,
  LiveBuzzerPlayerView,
  LiveQuestionForHost,
  LiveTeamSummary,
} from './types';

type LiveGameRow = typeof liveGameSchema.$inferSelect;
type GameWithNow = LiveGameRow & { dbNowMs: number };

const DISCONNECT_THRESHOLD_MS = 15 * 1000;

// DB 時鐘（毫秒）。LOCALTIMESTAMP 與 timestamp（無時區）欄位、預設 now() 同一套表示法，
// Drizzle 讀 timestamp 欄位時以 UTC 解讀，EXTRACT(EPOCH) 對無時區 timestamp 也是以 UTC 計，兩邊一致
const dbNowMsSql = sql<number>`(EXTRACT(EPOCH FROM LOCALTIMESTAMP) * 1000)::float8`.mapWith(Number);

// 給 API 回傳的繁中錯誤訊息
const MESSAGES: Record<string, string> = {
  GAME_NOT_FOUND: '找不到這場直播',
  WRONG_MODE: '這場不是小組搶答模式',
  NOT_PLAYING: '現在不是搶答時間',
  NOT_CURRENT_QUESTION: '題目已經換了，請重新整理',
  NO_TEAM: '你還沒有分組，請稍候',
  READING: '看題時間還沒結束，3 秒後才能搶答',
  ALREADY_BUZZED: '你的組已經搶過了',
  QUESTION_CLOSED: '這題已經有組答對了',
  NOT_YOUR_TURN: '還沒輪到你的組作答',
  TEAMMATE_ANSWERING: '由按下搶答的隊友作答，你不能代答',
  TIMEOUT: '作答時間已到',
  NO_PLAYERS: '需要至少 1 位玩家才能開始',
  ALREADY_STARTED: '遊戲已經開始了',
  NO_QUESTIONS: '此測驗沒有可用於小組搶答的題目',
};

export type BuzzerError = { ok: false; code: string; message: string; status: number };

function fail(code: string, status = 409): BuzzerError {
  return { ok: false, code, message: MESSAGES[code] ?? code, status };
}

async function loadGameWithDbNow(gameId: number): Promise<GameWithNow | null> {
  const [row] = await db
    .select({ ...getTableColumns(liveGameSchema), dbNowMs: dbNowMsSql })
    .from(liveGameSchema)
    .where(eq(liveGameSchema.id, gameId))
    .limit(1);
  return row ?? null;
}

async function getDbNowMs(gameId: number): Promise<number> {
  const [row] = await db
    .select({ now: dbNowMsSql })
    .from(liveGameSchema)
    .where(eq(liveGameSchema.id, gameId))
    .limit(1);
  return row?.now ?? Date.now();
}

async function loadBuzzRows(gameId: number, questionId: number) {
  return db
    .select()
    .from(liveBuzzSchema)
    .where(and(eq(liveBuzzSchema.gameId, gameId), eq(liveBuzzSchema.questionId, questionId)))
    .orderBy(asc(liveBuzzSchema.buzzedAt), asc(liveBuzzSchema.id));
}

type BuzzRow = Awaited<ReturnType<typeof loadBuzzRows>>[number];

function toBuzzState(r: BuzzRow): BuzzState {
  return {
    id: r.id,
    teamId: r.teamId,
    playerId: r.playerId,
    buzzedAtMs: r.buzzedAt.getTime(),
    result: r.result,
    answerGrantedAtMs: r.answerGrantedAt ? r.answerGrantedAt.getTime() : null,
  };
}

async function loadTeamIds(gameId: number): Promise<number[]> {
  const rows = await db
    .select({ id: liveTeamSchema.id })
    .from(liveTeamSchema)
    .where(eq(liveTeamSchema.gameId, gameId));
  return rows.map(r => r.id);
}

async function addTeamScore(teamId: number, delta: number) {
  if (delta === 0) {
    return;
  }
  await db
    .update(liveTeamSchema)
    .set({ score: sql`${liveTeamSchema.score} + ${delta}` })
    .where(eq(liveTeamSchema.id, teamId));
}

function currentQuestionOf(game: LiveGameRow, questions: LiveQuestionForHost[]): LiveQuestionForHost | null {
  return game.currentQuestionIndex >= 0 && game.currentQuestionIndex < questions.length
    ? questions[game.currentQuestionIndex] ?? null
    : null;
}

// playing → showing_result（以 status + 題號當 optimistic lock，重複呼叫只會成功一次）
async function closeQuestion(game: LiveGameRow): Promise<boolean> {
  const updated = await db
    .update(liveGameSchema)
    .set({ status: 'showing_result', nextTransitionAt: null })
    .where(and(
      eq(liveGameSchema.id, game.id),
      eq(liveGameSchema.status, 'playing'),
      eq(liveGameSchema.currentQuestionIndex, game.currentQuestionIndex),
    ))
    .returning();
  return updated.length > 0;
}

/**
 * Lazy 推進搶答狀態（逾時判定、發作答權、全組答錯即揭曉）。任何讀寫入口都會先呼叫。
 * 每一步都以「預期的舊狀態」當 WHERE 條件（optimistic lock）：兩個請求同時判定同一筆逾時，
 * 只有一個 UPDATE 會成功並扣分，另一個看到 0 rows 就停手，交給成功的那個繼續。
 * 同題同時最多一筆 answering 另有 partial unique index 當最後防線。
 * 回傳 true 代表有狀態改動。
 */
export async function reconcileBuzzerGame(
  game: GameWithNow,
  opts: {
    questions?: LiveQuestionForHost[]; // 呼叫端已讀過題目就傳進來，省一次 DB round trip
    publish?: boolean; // false = 呼叫端稍後自己發看板（避免同一個請求發兩次）
  } = {},
): Promise<boolean> {
  if (game.gameMode !== 'team_buzzer' || game.status !== 'playing') {
    return false;
  }
  const questions = opts.questions ?? await getGameQuestions(game.quizId, game.gameMode);
  const question = currentQuestionOf(game, questions);
  if (!question) {
    return false;
  }

  // 兩個查詢互不相依，並行送出
  const [buzzRows, teamIds] = await Promise.all([
    loadBuzzRows(game.id, question.id),
    loadTeamIds(game.id),
  ]);
  const buzzes = buzzRows.map(toBuzzState);
  const steps = planReconcile({ buzzes, teamIds, nowMs: game.dbNowMs });

  let changed = false;
  for (const step of steps) {
    if (step.kind === 'timeout') {
      const updated = await db
        .update(liveBuzzSchema)
        .set({ result: 'timeout', answeredAt: new Date(game.dbNowMs) })
        .where(and(eq(liveBuzzSchema.id, step.buzzId), eq(liveBuzzSchema.result, 'answering')))
        .returning();
      if (updated.length === 0) {
        break; // 別的請求已處理這筆逾時
      }
      await addTeamScore(step.teamId, step.delta);
      changed = true;
    } else if (step.kind === 'grant') {
      let updated: unknown[] = [];
      try {
        updated = await db
          .update(liveBuzzSchema)
          .set({ result: 'answering', answerGrantedAt: new Date(step.grantedAtMs) })
          .where(and(eq(liveBuzzSchema.id, step.buzzId), eq(liveBuzzSchema.result, 'queued')))
          .returning();
      } catch {
        // partial unique index（同題只能一筆 answering）擋下：別的請求已經發出作答權
        updated = [];
      }
      if (updated.length === 0) {
        break;
      }
      changed = true;
    } else if (await closeQuestion(game)) {
      changed = true;
    }
  }

  if (changed && opts.publish !== false) {
    // 例：輪詢 / 逾時排程觸發的讀取剛好判定逾時 → 直接把新看板推給全場，不用大家再各自打 REST
    await publishBuzzerBoard(game.id, questions);
  }
  return changed;
}

/**
 * 讀 DB 組出當前題的完整搶答看板（LiveBuzzerBoard）。
 * 2 次 round trip：先讀 game（含 DB 時鐘），再並行讀組 / 玩家暱稱 / 搶答紀錄。
 */
export async function buildBuzzerBoard(
  gameId: number,
  questionsHint?: LiveQuestionForHost[],
): Promise<LiveBuzzerBoard | null> {
  const game = await loadGameWithDbNow(gameId);
  if (!game || game.gameMode !== 'team_buzzer') {
    return null;
  }
  const questions = questionsHint ?? await getGameQuestions(game.quizId, game.gameMode);
  const question = currentQuestionOf(game, questions);
  if (!question) {
    return null;
  }
  const [teams, players, rows] = await Promise.all([
    db
      .select()
      .from(liveTeamSchema)
      .where(eq(liveTeamSchema.gameId, gameId))
      .orderBy(asc(liveTeamSchema.orderIndex)),
    db
      .select({ id: livePlayerSchema.id, nickname: livePlayerSchema.nickname })
      .from(livePlayerSchema)
      .where(eq(livePlayerSchema.gameId, gameId)),
    game.status === 'waiting' ? Promise.resolve([] as BuzzRow[]) : loadBuzzRows(gameId, question.id),
  ]);
  const teamSummaries = teams.map(t => ({ id: t.id, name: t.name, orderIndex: t.orderIndex, score: t.score }));
  return {
    gameId,
    questionId: question.id,
    questionIndex: game.currentQuestionIndex,
    status: game.status,
    serverNow: new Date(game.dbNowMs).toISOString(),
    teams: teamSummaries,
    // 看板會廣播給全場：拿掉所選答案（與學生端 player-state 同規則）
    buzzes: buildBuzzEntries(rows, teamSummaries, players).map(({ selectedOptionId: _omit, ...rest }) => rest),
    // 揭曉後才帶正解（與 player-state 的 lastResult 同規則）
    correctAnswers: game.status === 'showing_result' ? question.correctAnswers : null,
  };
}

/** 組看板 → 發到 Ably（未啟用 Ably 時只組不發）。回傳看板，讓 API 回應可以直接帶回去 */
async function publishBuzzerBoard(
  gameId: number,
  questionsHint?: LiveQuestionForHost[],
): Promise<LiveBuzzerBoard | null> {
  const board = await buildBuzzerBoard(gameId, questionsHint);
  if (board) {
    await publishBoard(gameId, board);
  } else {
    await publishTick(gameId);
  }
  return board;
}

/** 讀取 game 並順手執行搶答 lazy 推進（liveStore.loadGameWithAutoAdvance 的搶答版） */
export async function loadBuzzerGameReconciled(
  gameId: number,
  questionsHint?: LiveQuestionForHost[],
): Promise<GameWithNow | null> {
  const game = await loadGameWithDbNow(gameId);
  if (!game) {
    return null;
  }
  if (!(await reconcileBuzzerGame(game, { questions: questionsHint }))) {
    return game;
  }
  return loadGameWithDbNow(gameId);
}

/**
 * 老師按「分組並開始」：依加入順序 round-robin 分成 N 組 → 進第一題。
 * 整段包在 transaction 內，並以 status='waiting' 當 optimistic lock，老師連點兩下也只會分組一次。
 */
export async function startBuzzerGame(
  gameId: number,
  teamCount: number,
): Promise<{ ok: true } | BuzzerError> {
  const game = await loadGameWithDbNow(gameId);
  if (!game) {
    return fail('GAME_NOT_FOUND', 404);
  }
  if (game.gameMode !== 'team_buzzer') {
    return fail('WRONG_MODE', 400);
  }
  if (game.status !== 'waiting') {
    return fail('ALREADY_STARTED');
  }
  const questions = await getGameQuestions(game.quizId, game.gameMode);
  if (questions.length === 0) {
    return fail('NO_QUESTIONS', 400);
  }

  const players = await db
    .select({ id: livePlayerSchema.id })
    .from(livePlayerSchema)
    .where(eq(livePlayerSchema.gameId, gameId))
    .orderBy(asc(livePlayerSchema.joinedAt), asc(livePlayerSchema.id));
  if (players.length === 0) {
    return fail('NO_PLAYERS', 400);
  }
  const groups = assignTeamsByCount(players.map(p => p.id), teamCount);

  const started = await db.transaction(async (tx) => {
    const updated = await tx
      .update(liveGameSchema)
      .set({
        status: 'playing',
        teamCount,
        currentQuestionIndex: 0,
        questionStartedAt: new Date(game.dbNowMs),
        nextTransitionAt: null, // 搶答模式由老師主導節奏，不走 classic 自動推進
      })
      .where(and(eq(liveGameSchema.id, gameId), eq(liveGameSchema.status, 'waiting')))
      .returning();
    if (updated.length === 0) {
      return false;
    }
    const teams = await tx
      .insert(liveTeamSchema)
      .values(groups.map((_, i) => ({ gameId, name: teamNameFor(i), orderIndex: i })))
      .returning();
    for (const team of teams) {
      const memberIds = groups[team.orderIndex] ?? [];
      if (memberIds.length > 0) {
        await tx
          .update(livePlayerSchema)
          .set({ teamId: team.id })
          .where(inArray(livePlayerSchema.id, memberIds));
      }
    }
    return true;
  });
  if (!started) {
    return fail('ALREADY_STARTED');
  }

  await publishTick(gameId);
  return { ok: true };
}

/** 分組後才加入的學生：補進人數最少的組（同人數取組號小的）。還沒分組 / 已有組則不動 */
export async function assignLateJoiner(gameId: number, playerId: number): Promise<number | null> {
  const teams = await db
    .select({
      id: liveTeamSchema.id,
      orderIndex: liveTeamSchema.orderIndex,
      memberCount: sql<number>`count(${livePlayerSchema.id})`.mapWith(Number),
    })
    .from(liveTeamSchema)
    .leftJoin(livePlayerSchema, eq(livePlayerSchema.teamId, liveTeamSchema.id))
    .where(eq(liveTeamSchema.gameId, gameId))
    .groupBy(liveTeamSchema.id, liveTeamSchema.orderIndex);
  const teamId = pickTeamForLateJoiner(teams);
  if (teamId === null) {
    return null;
  }
  const updated = await db
    .update(livePlayerSchema)
    .set({ teamId })
    .where(and(
      eq(livePlayerSchema.id, playerId),
      eq(livePlayerSchema.gameId, gameId),
      isNull(livePlayerSchema.teamId),
    ))
    .returning();
  if (updated.length > 0) {
    await publishTick(gameId);
    return teamId;
  }
  return null;
}

async function loadPlayer(gameId: number, playerId: number) {
  const [me] = await db
    .select({ id: livePlayerSchema.id, teamId: livePlayerSchema.teamId })
    .from(livePlayerSchema)
    .where(and(eq(livePlayerSchema.id, playerId), eq(livePlayerSchema.gameId, gameId)))
    .limit(1);
  return me ?? null;
}

// 共用前置檢查：模式、題目是否為當前題
async function loadPlayingContext(gameId: number, questionId: number): Promise<
  | { ok: true; game: GameWithNow; question: LiveQuestionForHost; questions: LiveQuestionForHost[] }
  | { ok: false; error: BuzzerError }
> {
  const raw = await loadGameWithDbNow(gameId);
  if (!raw) {
    return { ok: false, error: fail('GAME_NOT_FOUND', 404) };
  }
  if (raw.gameMode !== 'team_buzzer') {
    return { ok: false, error: fail('WRONG_MODE', 400) };
  }
  // 題目只讀一次，往下傳給 reconcile / 看板（原本同一個請求會讀 3 次）
  const questions = await getGameQuestions(raw.quizId, raw.gameMode);
  const game = (await reconcileBuzzerGame(raw, { questions })) ? await loadGameWithDbNow(gameId) : raw;
  if (!game) {
    return { ok: false, error: fail('GAME_NOT_FOUND', 404) };
  }
  if (game.status !== 'playing') {
    return { ok: false, error: fail('NOT_PLAYING') };
  }
  const question = currentQuestionOf(game, questions);
  if (!question || question.id !== questionId) {
    return { ok: false, error: fail('NOT_CURRENT_QUESTION') };
  }
  return { ok: true, game, question, questions };
}

/**
 * 學生按搶答。順序以 DB insert 時間（buzzedAt 預設 now()）為準；每組每題最多一筆由
 * unique(game_id, question_id, team_id) 保證，併發時 onConflictDoNothing 讓第二筆安靜失敗。
 */
export async function recordBuzz(params: {
  gameId: number;
  playerId: number;
  questionId: number;
}): Promise<{ ok: true; order: number; granted: boolean; board: LiveBuzzerBoard | null } | BuzzerError> {
  const { gameId, playerId, questionId } = params;
  const ctx = await loadPlayingContext(gameId, questionId);
  if (!ctx.ok) {
    return ctx.error;
  }
  const { game, questions } = ctx;

  const [me, buzzRows] = await Promise.all([
    loadPlayer(gameId, playerId),
    loadBuzzRows(gameId, questionId),
  ]);
  if (!me) {
    return fail('GAME_NOT_FOUND', 404);
  }
  const buzzes = buzzRows.map(toBuzzState);
  const allowed = checkBuzzAllowed({
    status: game.status,
    questionStartedAtMs: game.questionStartedAt ? game.questionStartedAt.getTime() : null,
    nowMs: game.dbNowMs,
    teamId: me.teamId,
    buzzes,
  });
  if (!allowed.ok) {
    return fail(allowed.reason);
  }

  const inserted = await db
    .insert(liveBuzzSchema)
    .values({ gameId, questionId, teamId: me.teamId!, playerId })
    .onConflictDoNothing()
    .returning();
  const buzzId = inserted[0]?.id;
  if (!buzzId) {
    return fail('ALREADY_BUZZED');
  }

  // 重新讀 DB 時鐘再推進：若目前沒人持有作答權，這筆會立刻取得作答權（15 秒從現在起算）
  const fresh = await loadGameWithDbNow(gameId);
  if (fresh) {
    await reconcileBuzzerGame(fresh, { questions, publish: false });
  }

  // 只發一則「完整看板」（原本是 reconcile + 這裡各發一次 tick，全場收到後再各自打 REST 重抓）。
  // 同一份看板也放進回應，按的人不用等 Ably / 輪詢就看得到自己第幾個搶到
  const board = await publishBuzzerBoard(gameId, questions);
  const mine = board?.buzzes.find(b => b.id === buzzId);
  let order = mine?.order ?? 0;
  let granted = mine?.result === 'answering';
  if (!board) {
    const after = sortBuzzes((await loadBuzzRows(gameId, questionId)).map(toBuzzState));
    order = after.findIndex(b => b.id === buzzId) + 1;
    granted = after.find(b => b.id === buzzId)?.result === 'answering';
  }
  return { ok: true, order, granted, board };
}

/** 持有作答權的學生送出答案：答對 +100 並揭曉；答錯 −50 並把作答權交給下一組 */
export async function recordBuzzAnswer(params: {
  gameId: number;
  playerId: number;
  questionId: number;
  selectedOptionId: string | string[];
}): Promise<{ ok: true; isCorrect: boolean; delta: number; board: LiveBuzzerBoard | null } | BuzzerError> {
  const { gameId, playerId, questionId, selectedOptionId } = params;
  const ctx = await loadPlayingContext(gameId, questionId);
  if (!ctx.ok) {
    return ctx.error;
  }
  const { game, question, questions } = ctx;

  const [me, buzzRows] = await Promise.all([
    loadPlayer(gameId, playerId),
    loadBuzzRows(gameId, questionId),
  ]);
  if (!me) {
    return fail('GAME_NOT_FOUND', 404);
  }
  const buzzes = buzzRows.map(toBuzzState);
  const allowed = checkAnswerAllowed({ buzzes, playerId, teamId: me.teamId, nowMs: game.dbNowMs });
  if (!allowed.ok) {
    return fail(allowed.reason, allowed.reason === 'TEAMMATE_ANSWERING' ? 403 : 409);
  }

  const isCorrect = gradeAnswer(question.type, question.correctAnswers, selectedOptionId);
  const result = isCorrect ? 'correct' : 'wrong';
  const updated = await db
    .update(liveBuzzSchema)
    .set({ result, selectedOptionId, answeredAt: new Date(game.dbNowMs) })
    .where(and(
      eq(liveBuzzSchema.id, allowed.buzzId),
      eq(liveBuzzSchema.playerId, playerId),
      eq(liveBuzzSchema.result, 'answering'),
    ))
    .returning();
  const row = updated[0];
  if (!row) {
    // 同一瞬間被別的請求判定逾時
    return fail('TIMEOUT');
  }

  const delta = scoreDeltaFor(result);
  await addTeamScore(row.teamId, delta);

  if (isCorrect) {
    // 答對即自動揭曉，老師再按「下一題」
    await closeQuestion(game);
  } else {
    // 答錯：作答權交給下一個排隊的組（沒人排隊就回到開放搶答 / 全組答錯即揭曉）
    const fresh = await loadGameWithDbNow(gameId);
    if (fresh) {
      await reconcileBuzzerGame(fresh, { questions, publish: false });
    }
  }
  // 一則完整看板：結果、組分、下一組作答權一次到位
  const board = await publishBuzzerBoard(gameId, questions);
  return { ok: true, isCorrect, delta, board };
}

/** 老師按「揭曉答案」：playing → showing_result（沒人答對也可以） */
export async function revealBuzzerAnswer(gameId: number): Promise<{ ok: true } | BuzzerError> {
  const game = await loadBuzzerGameReconciled(gameId);
  if (!game) {
    return fail('GAME_NOT_FOUND', 404);
  }
  if (game.gameMode !== 'team_buzzer') {
    return fail('WRONG_MODE', 400);
  }
  if (game.status === 'playing') {
    await closeQuestion(game);
    // 看板帶正解，學生端直接切到揭曉畫面，不用再打 REST
    await publishBuzzerBoard(gameId);
  }
  return { ok: true };
}

/** 老師按「下一題」：showing_result → 下一題 playing，最後一題則 finished。重複呼叫為無害 no-op */
export async function nextBuzzerQuestion(
  gameId: number,
): Promise<{ ok: true; finished: boolean } | BuzzerError> {
  const game = await loadGameWithDbNow(gameId);
  if (!game) {
    return fail('GAME_NOT_FOUND', 404);
  }
  if (game.gameMode !== 'team_buzzer') {
    return fail('WRONG_MODE', 400);
  }
  if (game.status !== 'showing_result') {
    return { ok: true, finished: game.status === 'finished' };
  }

  const questions = await getGameQuestions(game.quizId, game.gameMode);
  const nextIdx = game.currentQuestionIndex + 1;
  const finished = nextIdx >= questions.length;
  await db
    .update(liveGameSchema)
    .set(finished
      ? { status: 'finished', endedAt: new Date(game.dbNowMs), nextTransitionAt: null }
      : {
          status: 'playing',
          currentQuestionIndex: nextIdx,
          questionStartedAt: new Date(game.dbNowMs),
          nextTransitionAt: null,
        })
    .where(and(
      eq(liveGameSchema.id, gameId),
      eq(liveGameSchema.status, 'showing_result'),
      eq(liveGameSchema.currentQuestionIndex, game.currentQuestionIndex),
    ));

  await publishTick(gameId);
  return { ok: true, finished };
}

// ── state 組裝（host-state / player-state 用） ───────────────────────────

async function loadTeamsWithMembers(gameId: number): Promise<{
  teams: LiveTeamSummary[];
  players: { id: number; nickname: string; teamId: number | null }[];
}> {
  // 兩個查詢互不相依，並行送出
  const [teams, players] = await Promise.all([
    db
      .select()
      .from(liveTeamSchema)
      .where(eq(liveTeamSchema.gameId, gameId))
      .orderBy(asc(liveTeamSchema.orderIndex)),
    db
      .select({
        id: livePlayerSchema.id,
        nickname: livePlayerSchema.nickname,
        teamId: livePlayerSchema.teamId,
        lastSeenAt: livePlayerSchema.lastSeenAt,
      })
      .from(livePlayerSchema)
      .where(eq(livePlayerSchema.gameId, gameId))
      .orderBy(asc(livePlayerSchema.joinedAt), asc(livePlayerSchema.id)),
  ]);

  // lastSeenAt 由 heartbeat 以 JS Date 寫入，跟既有 getPlayers 一樣用 JS 時鐘比較
  const jsNow = Date.now();
  return {
    teams: teams.map(t => ({
      id: t.id,
      name: t.name,
      orderIndex: t.orderIndex,
      score: t.score,
      members: players
        .filter(p => p.teamId === t.id)
        .map(p => ({
          id: p.id,
          nickname: p.nickname,
          disconnected: jsNow - p.lastSeenAt.getTime() > DISCONNECT_THRESHOLD_MS,
        })),
    })),
    players: players.map(p => ({ id: p.id, nickname: p.nickname, teamId: p.teamId })),
  };
}

function buildBuzzEntries(
  rows: BuzzRow[],
  teams: { id: number; name: string }[],
  players: { id: number; nickname: string }[],
): LiveBuzzEntryForHost[] {
  const teamName = new Map(teams.map(t => [t.id, t.name]));
  const nickname = new Map(players.map(p => [p.id, p.nickname]));
  // rows 已由 SQL 依 buzzedAt, id 排序；這裡再排一次保險（與 sortBuzzes 同規則）
  const sorted = [...rows].sort((a, b) => a.buzzedAt.getTime() - b.buzzedAt.getTime() || a.id - b.id);
  return sorted.map((r, i) => ({
    id: r.id,
    order: i + 1,
    teamId: r.teamId,
    teamName: teamName.get(r.teamId) ?? '',
    playerId: r.playerId,
    nickname: nickname.get(r.playerId) ?? '',
    result: r.result,
    buzzedAt: r.buzzedAt.toISOString(),
    answerGrantedAt: r.answerGrantedAt ? r.answerGrantedAt.toISOString() : null,
    answerDeadlineAt: r.answerGrantedAt
      ? new Date(r.answerGrantedAt.getTime() + BUZZER_ANSWER_MS).toISOString()
      : null,
    selectedOptionId: r.selectedOptionId ?? null,
  }));
}

async function loadPlayerStats(gameId: number): Promise<Map<number, { won: number; correct: number }>> {
  const rows = await db
    .select({
      playerId: liveBuzzSchema.playerId,
      won: sql<number>`count(*) filter (where ${liveBuzzSchema.answerGrantedAt} is not null)`.mapWith(Number),
      correct: sql<number>`count(*) filter (where ${liveBuzzSchema.result} = 'correct')`.mapWith(Number),
    })
    .from(liveBuzzSchema)
    .where(eq(liveBuzzSchema.gameId, gameId))
    .groupBy(liveBuzzSchema.playerId);
  return new Map(rows.map(r => [r.playerId, { won: r.won, correct: r.correct }]));
}

export async function buildBuzzerHostView(
  game: LiveGameRow,
  currentQuestion: LiveQuestionForHost | null,
): Promise<LiveBuzzerHostView> {
  // 4 個查詢互不相依，並行送出（原本依序 await，每個都是一次 DB round trip）
  const [nowMs, { teams, players }, rows, stats] = await Promise.all([
    getDbNowMs(game.id),
    loadTeamsWithMembers(game.id),
    currentQuestion && game.status !== 'waiting'
      ? loadBuzzRows(game.id, currentQuestion.id)
      : Promise.resolve([] as BuzzRow[]),
    loadPlayerStats(game.id),
  ]);
  const playerStats: LiveBuzzerPlayerStat[] = players.map(p => ({
    playerId: p.id,
    nickname: p.nickname,
    teamId: p.teamId,
    buzzWonCount: stats.get(p.id)?.won ?? 0,
    buzzCorrectCount: stats.get(p.id)?.correct ?? 0,
  }));

  return {
    serverNow: new Date(nowMs).toISOString(),
    readingMs: BUZZER_READING_MS,
    answerMs: BUZZER_ANSWER_MS,
    teams,
    buzzes: buildBuzzEntries(rows, teams, players),
    unassignedCount: players.filter(p => p.teamId === null).length,
    playerStats,
  };
}

export async function buildBuzzerPlayerView(
  game: LiveGameRow,
  currentQuestion: LiveQuestionForHost | null,
  playerId: number,
): Promise<LiveBuzzerPlayerView> {
  // Self-heal：已分組後加入、但 join 當下補位失敗的學生，讀取時再補一次
  if (game.status !== 'waiting') {
    const me = await loadPlayer(game.id, playerId);
    if (me && me.teamId === null) {
      await assignLateJoiner(game.id, playerId);
    }
  }

  const [nowMs, { teams, players }, rows, allStats] = await Promise.all([
    getDbNowMs(game.id),
    loadTeamsWithMembers(game.id),
    currentQuestion && game.status !== 'waiting'
      ? loadBuzzRows(game.id, currentQuestion.id)
      : Promise.resolve([] as BuzzRow[]),
    loadPlayerStats(game.id),
  ]);
  const stats = allStats.get(playerId);
  const myTeamId = players.find(p => p.id === playerId)?.teamId ?? null;
  const myTeam = teams.find(t => t.id === myTeamId) ?? null;

  return {
    serverNow: new Date(nowMs).toISOString(),
    readingMs: BUZZER_READING_MS,
    answerMs: BUZZER_ANSWER_MS,
    teams,
    myTeam: myTeam ? { id: myTeam.id, name: myTeam.name, score: myTeam.score } : null,
    // 學生端不給所選答案（揭曉前可能洩漏線索）
    buzzes: buildBuzzEntries(rows, teams, players).map(({ selectedOptionId: _omit, ...rest }) => rest),
    myStats: { buzzWonCount: stats?.won ?? 0, buzzCorrectCount: stats?.correct ?? 0 },
  };
}
