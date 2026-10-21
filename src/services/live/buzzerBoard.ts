// Live Mode「小組搶答」看板快照（LiveBuzzerBoard）的 client 端套用邏輯：全部是純函式。
// server 每次搶答狀態改變都會發「完整」快照（不是增量），client 只要判斷新舊、合併進既有 state。
// 這支檔案會被學生端 / 老師端 hook import，不可 import 任何 server-only 模組。

import type {
  LiveBuzzEntry,
  LiveBuzzerBoard,
  LiveBuzzResult,
  LiveGameStatus,
  LiveHostState,
  LivePlayerState,
} from './types';

const STATUS_RANK: Record<LiveGameStatus, number> = {
  waiting: 0,
  playing: 1,
  showing_result: 2,
  finished: 3,
};

const RESULT_RANK: Record<LiveBuzzResult, number> = {
  queued: 1,
  answering: 2,
  correct: 3,
  wrong: 3,
  timeout: 3,
};

/**
 * 搶答狀態的「新舊」鍵值。同一題內搶答狀態只會往前走：
 * 新增一筆搶答（+1）、排隊 → 作答中（+1）、作答中 → 答對 / 答錯 / 逾時（+1）、playing → showing_result。
 * 所以 [題號, 狀態, 各筆搶答進度總和, server 時鐘] 依序比較，越大越新；
 * 不同 lambda 發的快照、或晚到的 REST 回應亂序抵達時，用它丟掉舊的，畫面不會倒退。
 */
export type BuzzerFreshness = [questionIndex: number, statusRank: number, progress: number, serverNowMs: number];

export function buzzerFreshness(params: {
  questionIndex: number;
  status: LiveGameStatus;
  buzzes: { result: LiveBuzzResult }[];
  serverNow: string;
}): BuzzerFreshness {
  const progress = params.buzzes.reduce((sum, b) => sum + RESULT_RANK[b.result], 0);
  const serverNowMs = Date.parse(params.serverNow);
  return [
    params.questionIndex,
    STATUS_RANK[params.status],
    progress,
    Number.isFinite(serverNowMs) ? serverNowMs : 0,
  ];
}

/** a 比 b 舊回傳負數、一樣新回傳 0、比較新回傳正數 */
export function compareFreshness(a: BuzzerFreshness, b: BuzzerFreshness): number {
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!;
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function freshnessOfState(state: LivePlayerState | LiveHostState): BuzzerFreshness | null {
  if (state.game.gameMode !== 'team_buzzer' || !state.buzzer) {
    return null;
  }
  return buzzerFreshness({
    questionIndex: state.game.currentQuestionIndex,
    status: state.game.status,
    buzzes: state.buzzer.buzzes,
    serverNow: state.buzzer.serverNow,
  });
}

function freshnessOfBoard(board: LiveBuzzerBoard): BuzzerFreshness {
  return buzzerFreshness({
    questionIndex: board.questionIndex,
    status: board.status,
    buzzes: board.buzzes,
    serverNow: board.serverNow,
  });
}

/**
 * REST 回來的 state 是否比畫面上的舊（只有小組搶答才比較；classic 一律視為不舊，行為不變）。
 * 例：按搶答後回應帶回的快照已經是「第 2 個搶到」，但更早發出的輪詢晚一步才回來（還沒有這筆搶答）→ 丟掉。
 */
export function isStaleBuzzerState<S extends LivePlayerState | LiveHostState>(prev: S | null, next: S): boolean {
  if (!prev) {
    return false;
  }
  const a = freshnessOfState(prev);
  const b = freshnessOfState(next);
  if (!a || !b) {
    return false;
  }
  return compareFreshness(b, a) < 0;
}

export type ApplyBoardResult<S> =
  | { kind: 'applied'; state: S }
  | { kind: 'ignored' } // 快照比畫面舊（或是別場 / 舊題的），什麼都不做
  | { kind: 'refetch' }; // 快照已經是下一題 / 遊戲狀態 REST 才有（題目內容、排行榜）→ 重抓 REST

function checkBoard(
  state: LivePlayerState | LiveHostState | null,
  board: LiveBuzzerBoard,
): 'ok' | 'ignored' | 'refetch' {
  if (!state || state.game.id !== board.gameId || state.game.gameMode !== 'team_buzzer' || !state.buzzer) {
    return state && state.game.id !== board.gameId ? 'ignored' : 'refetch';
  }
  if (board.questionIndex < state.game.currentQuestionIndex) {
    return 'ignored';
  }
  if (board.questionIndex > state.game.currentQuestionIndex || state.currentQuestion?.id !== board.questionId) {
    return 'refetch';
  }
  if (board.status === 'finished' || board.status === 'waiting') {
    return 'refetch';
  }
  const current = freshnessOfState(state)!;
  return compareFreshness(freshnessOfBoard(board), current) < 0 ? 'ignored' : 'ok';
}

// 快照的組只有分數，沒有成員（成員 / 斷線狀態仍以 REST 為準）：沿用畫面上已有的成員
function mergeTeams<T extends { id: number; members: { id: number; nickname: string; disconnected: boolean }[] }>(
  prevTeams: T[],
  boardTeams: LiveBuzzerBoard['teams'],
) {
  const members = new Map(prevTeams.map(t => [t.id, t.members]));
  return boardTeams.map(t => ({ ...t, members: members.get(t.id) ?? [] }));
}

/** 學生端：把快照合併進 LivePlayerState */
export function applyBoardToPlayerState(
  state: LivePlayerState | null,
  board: LiveBuzzerBoard,
): ApplyBoardResult<LivePlayerState> {
  const check = checkBoard(state, board);
  if (check !== 'ok') {
    return { kind: check };
  }
  const prev = state!;
  const buzzer = prev.buzzer!;
  const teams = mergeTeams(buzzer.teams, board.teams);
  const myTeam = buzzer.myTeam
    ? (() => {
        const t = teams.find(x => x.id === buzzer.myTeam!.id);
        return t ? { id: t.id, name: t.name, score: t.score } : buzzer.myTeam;
      })()
    : null;
  return {
    kind: 'applied',
    state: {
      ...prev,
      game: { ...prev.game, status: board.status },
      lastResult: board.status === 'showing_result' && board.correctAnswers
        ? { correctAnswers: board.correctAnswers, answerStats: prev.lastResult?.answerStats ?? [] }
        : prev.lastResult,
      buzzer: {
        ...buzzer,
        serverNow: board.serverNow,
        teams,
        myTeam,
        buzzes: board.buzzes,
      },
    },
  };
}

/** 老師端：把快照合併進 LiveHostState（快照不含所選答案，沿用畫面上已有的；老師端畫面也沒用到） */
export function applyBoardToHostState(
  state: LiveHostState | null,
  board: LiveBuzzerBoard,
): ApplyBoardResult<LiveHostState> {
  const check = checkBoard(state, board);
  if (check !== 'ok') {
    return { kind: check };
  }
  const prev = state!;
  const buzzer = prev.buzzer!;
  const selected = new Map(buzzer.buzzes.map(b => [b.id, b.selectedOptionId]));
  return {
    kind: 'applied',
    state: {
      ...prev,
      game: { ...prev.game, status: board.status },
      buzzer: {
        ...buzzer,
        serverNow: board.serverNow,
        teams: mergeTeams(buzzer.teams, board.teams),
        buzzes: board.buzzes.map((b: LiveBuzzEntry) => ({ ...b, selectedOptionId: selected.get(b.id) ?? null })),
      },
    },
  };
}

/**
 * 作答中那組的截止時間距離「收到這份 state 當下」還有幾毫秒（沒有作答中的組則 null）。
 * 逾時判定是 server lazy 執行的：Ably 模式沒有輪詢，截止時間一到要有人打一次 REST 才會換下一組，
 * hook 用這個值排一次 refetch。
 */
export function msUntilAnswerDeadline(state: LivePlayerState | LiveHostState | null): number | null {
  if (!state || state.game.status !== 'playing' || !state.buzzer) {
    return null;
  }
  const answering = state.buzzer.buzzes.find(b => b.result === 'answering');
  if (!answering?.answerDeadlineAt) {
    return null;
  }
  const deadline = Date.parse(answering.answerDeadlineAt);
  const now = Date.parse(state.buzzer.serverNow);
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) {
    return null;
  }
  return Math.max(0, deadline - now);
}
