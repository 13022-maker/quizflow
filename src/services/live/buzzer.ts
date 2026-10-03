// Live Mode「小組搶答」（team_buzzer）狀態機：全部是不碰 DB 的純函式。
// store 層（buzzerStore.ts）負責讀寫 DB 與 optimistic lock，這裡只決定「該發生什麼事」。
// 所有時間一律用 server（DB）時鐘的毫秒數，client 時間不參與判定。
// 這支檔案也會被學生端元件 import（derivePlayerBuzzPhase），所以不可 import 任何 server-only 模組。

import type { LiveGameStatus } from './types';

// 題目顯示後的「看題倒數」：questionStartedAt + 3 秒前按搶答一律拒絕
export const BUZZER_READING_MS = 3_000;
// 取得作答權後的作答時限
export const BUZZER_ANSWER_MS = 15_000;
export const BUZZER_CORRECT_POINTS = 100;
export const BUZZER_WRONG_PENALTY = -50;
export const BUZZER_MIN_TEAMS = 2;
export const BUZZER_MAX_TEAMS = 8;
export const BUZZER_DEFAULT_TEAMS = 4;

// 搶答模式支援的題型（聽力題要先聽完音檔才能作答，與搶答節奏衝突，排除）
export const BUZZER_SUPPORTED_TYPES = ['single_choice', 'multiple_choice', 'true_false'] as const;

export function isBuzzerSupportedType(type: string): boolean {
  return (BUZZER_SUPPORTED_TYPES as readonly string[]).includes(type);
}

export type BuzzResult = 'queued' | 'answering' | 'correct' | 'wrong' | 'timeout';

export type BuzzState = {
  id: number;
  teamId: number;
  playerId: number;
  buzzedAtMs: number; // server 收到搶答的時間（DB insert 時間）
  result: BuzzResult;
  answerGrantedAtMs: number | null;
};

const FAILED_RESULTS: BuzzResult[] = ['wrong', 'timeout'];

export function teamNameFor(orderIndex: number): string {
  return `第 ${orderIndex + 1} 組`;
}

// 搶答順序：server 收到時間早者優先；同一毫秒才用 id（insert 順序）決勝
export function sortBuzzes<T extends { buzzedAtMs: number; id: number }>(buzzes: T[]): T[] {
  return [...buzzes].sort((a, b) => a.buzzedAtMs - b.buzzedAtMs || a.id - b.id);
}

export function scoreDeltaFor(result: BuzzResult): number {
  if (result === 'correct') {
    return BUZZER_CORRECT_POINTS;
  }
  if (FAILED_RESULTS.includes(result)) {
    return BUZZER_WRONG_PENALTY;
  }
  return 0;
}

export type BuzzRejectReason = 'NOT_PLAYING' | 'READING' | 'NO_TEAM' | 'ALREADY_BUZZED' | 'QUESTION_CLOSED';

/** 判斷某組現在能不能按搶答（同組第二人 / 已答錯的組都算 ALREADY_BUZZED） */
export function checkBuzzAllowed(params: {
  status: LiveGameStatus;
  questionStartedAtMs: number | null;
  nowMs: number;
  teamId: number | null;
  buzzes: BuzzState[];
}): { ok: true } | { ok: false; reason: BuzzRejectReason } {
  const { status, questionStartedAtMs, nowMs, teamId, buzzes } = params;
  if (status !== 'playing' || questionStartedAtMs === null) {
    return { ok: false, reason: 'NOT_PLAYING' };
  }
  if (teamId === null) {
    return { ok: false, reason: 'NO_TEAM' };
  }
  if (nowMs < questionStartedAtMs + BUZZER_READING_MS) {
    return { ok: false, reason: 'READING' };
  }
  if (buzzes.some(b => b.result === 'correct')) {
    return { ok: false, reason: 'QUESTION_CLOSED' };
  }
  if (buzzes.some(b => b.teamId === teamId)) {
    return { ok: false, reason: 'ALREADY_BUZZED' };
  }
  return { ok: true };
}

export type ReconcileStep =
  | { kind: 'timeout'; buzzId: number; teamId: number; delta: number }
  | { kind: 'grant'; buzzId: number; grantedAtMs: number }
  | { kind: 'close' }; // 本題結束（有組答對 / 全組答錯）→ 進入揭曉

/**
 * 依目前搶答紀錄決定下一步（lazy：每次讀取 / 寫入時呼叫）。
 * 1. 持有作答權的組滿 15 秒 → timeout（−50）
 * 2. 有組答對 → close
 * 3. 沒人持有作答權 → 最早排隊的組取得作答權（從 nowMs 起算 15 秒，而不是從上一組逾時的
 *    那一刻起算——學生要等輪詢看到畫面才開始作答，從偵測時間起算才公平）
 * 4. 沒人排隊且每一組都答錯過 → close；否則回到開放搶答（不產生步驟）
 */
export function planReconcile(params: {
  buzzes: BuzzState[];
  teamIds: number[];
  nowMs: number;
}): ReconcileStep[] {
  const { teamIds, nowMs } = params;
  const buzzes = sortBuzzes(params.buzzes).map(b => ({ ...b }));
  const steps: ReconcileStep[] = [];

  const answering = buzzes.find(b => b.result === 'answering');
  if (answering) {
    const grantedAt = answering.answerGrantedAtMs ?? nowMs;
    if (nowMs >= grantedAt + BUZZER_ANSWER_MS) {
      steps.push({ kind: 'timeout', buzzId: answering.id, teamId: answering.teamId, delta: scoreDeltaFor('timeout') });
      answering.result = 'timeout';
    } else {
      return steps; // 作答中、未逾時：什麼都不做
    }
  }

  if (buzzes.some(b => b.result === 'correct')) {
    steps.push({ kind: 'close' });
    return steps;
  }

  const nextQueued = buzzes.find(b => b.result === 'queued');
  if (nextQueued) {
    steps.push({ kind: 'grant', buzzId: nextQueued.id, grantedAtMs: nowMs });
    return steps;
  }

  const failedTeams = new Set(buzzes.filter(b => FAILED_RESULTS.includes(b.result)).map(b => b.teamId));
  if (teamIds.length > 0 && teamIds.every(id => failedTeams.has(id))) {
    steps.push({ kind: 'close' });
  }
  return steps;
}

export type AnswerRejectReason = 'NOT_YOUR_TURN' | 'TEAMMATE_ANSWERING' | 'TIMEOUT';

/** 只有「持有作答權那筆搶答」的按鈴者本人、且在 15 秒內，才能送出答案 */
export function checkAnswerAllowed(params: {
  buzzes: BuzzState[];
  playerId: number;
  teamId: number | null;
  nowMs: number;
}): { ok: true; buzzId: number } | { ok: false; reason: AnswerRejectReason } {
  const { buzzes, playerId, teamId, nowMs } = params;
  const answering = buzzes.find(b => b.result === 'answering');
  if (!answering || answering.teamId !== teamId) {
    return { ok: false, reason: 'NOT_YOUR_TURN' };
  }
  if (answering.playerId !== playerId) {
    return { ok: false, reason: 'TEAMMATE_ANSWERING' };
  }
  if (answering.answerGrantedAtMs === null || nowMs >= answering.answerGrantedAtMs + BUZZER_ANSWER_MS) {
    return { ok: false, reason: 'TIMEOUT' };
  }
  return { ok: true, buzzId: answering.id };
}

/**
 * 依加入順序 round-robin 分組（第 i 位 → 第 i % N 組）。
 * 人數少於組數時，組數縮成人數，避免出現永遠沒人的空組卡住「全組答錯」判定。
 */
export function assignTeamsByCount(playerIds: number[], teamCount: number): number[][] {
  const n = Math.min(Math.max(1, teamCount), playerIds.length);
  const teams: number[][] = Array.from({ length: n }, () => []);
  playerIds.forEach((id, i) => {
    teams[i % n]!.push(id);
  });
  return teams;
}

/** 分組後才加入的學生：補進人數最少的組，同人數取組號小的 */
export function pickTeamForLateJoiner(
  teams: { id: number; orderIndex: number; memberCount: number }[],
): number | null {
  const sorted = [...teams].sort((a, b) => a.memberCount - b.memberCount || a.orderIndex - b.orderIndex);
  return sorted[0]?.id ?? null;
}

// ── 學生端畫面狀態（client 也會用，以 server 時鐘校正後的 nowMs 呼叫） ─────────

export type PlayerBuzzEntry = {
  teamId: number;
  teamName: string;
  playerId: number;
  nickname: string;
  result: BuzzResult;
  answerGrantedAtMs: number | null;
  order: number; // 1-based 搶答名次
};

export type PlayerBuzzPhase =
  | { kind: 'no_team' }
  | { kind: 'reading'; secondsLeft: number }
  | { kind: 'open' }
  | { kind: 'queued'; position: number; answeringTeamName: string | null }
  | { kind: 'answering_me'; secondsLeft: number }
  | { kind: 'answering_teammate'; nickname: string; secondsLeft: number }
  | { kind: 'other_team_answering'; teamName: string; canBuzz: boolean }
  | { kind: 'my_team_failed' }
  | { kind: 'revealed' };

export function derivePlayerBuzzPhase(params: {
  status: LiveGameStatus;
  questionStartedAtMs: number | null;
  nowMs: number;
  myTeamId: number | null;
  myPlayerId: number;
  buzzes: PlayerBuzzEntry[];
}): PlayerBuzzPhase {
  const { status, questionStartedAtMs, nowMs, myTeamId, myPlayerId } = params;
  if (status === 'showing_result') {
    return { kind: 'revealed' };
  }
  if (myTeamId === null) {
    return { kind: 'no_team' };
  }
  const readingEndsAt = (questionStartedAtMs ?? nowMs) + BUZZER_READING_MS;
  if (nowMs < readingEndsAt) {
    return { kind: 'reading', secondsLeft: Math.ceil((readingEndsAt - nowMs) / 1000) };
  }

  const buzzes = [...params.buzzes].sort((a, b) => a.order - b.order);
  if (buzzes.some(b => b.result === 'correct')) {
    return { kind: 'revealed' }; // 有組答對、server 正要切到揭曉的空檔
  }
  const answering = buzzes.find(b => b.result === 'answering') ?? null;
  const mine = buzzes.find(b => b.teamId === myTeamId) ?? null;
  const answerSecondsLeft = (b: PlayerBuzzEntry) =>
    Math.max(0, Math.ceil(((b.answerGrantedAtMs ?? nowMs) + BUZZER_ANSWER_MS - nowMs) / 1000));

  if (mine?.result === 'answering') {
    return mine.playerId === myPlayerId
      ? { kind: 'answering_me', secondsLeft: answerSecondsLeft(mine) }
      : { kind: 'answering_teammate', nickname: mine.nickname, secondsLeft: answerSecondsLeft(mine) };
  }
  if (mine && FAILED_RESULTS.includes(mine.result)) {
    return { kind: 'my_team_failed' };
  }
  if (mine?.result === 'queued') {
    const queued = buzzes.filter(b => b.result === 'queued');
    return {
      kind: 'queued',
      position: queued.findIndex(b => b.teamId === myTeamId) + 1,
      answeringTeamName: answering?.teamName ?? null,
    };
  }
  if (answering) {
    return { kind: 'other_team_answering', teamName: answering.teamName, canBuzz: !mine };
  }
  return { kind: 'open' };
}
