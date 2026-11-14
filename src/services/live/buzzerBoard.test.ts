// 搶答看板快照套用邏輯（純函式）：新舊判斷、合併、亂序丟棄。期望值全部手寫 literal
import { describe, expect, it } from 'vitest';

import {
  applyBoardToHostState,
  applyBoardToPlayerState,
  buzzerFreshness,
  compareFreshness,
  isStaleBuzzerState,
  msUntilAnswerDeadline,
} from './buzzerBoard';
import type { LiveBuzzEntry, LiveBuzzerBoard, LiveHostState, LivePlayerState } from './types';

const NOW = '2026-10-11T08:00:30.000Z';
const LATER = '2026-10-11T08:00:31.000Z';

function entry(p: Pick<LiveBuzzEntry, 'id' | 'order' | 'teamId' | 'result'> & Partial<LiveBuzzEntry>): LiveBuzzEntry {
  return {
    teamName: `第 ${p.teamId} 組`,
    playerId: p.teamId * 10,
    nickname: `p${p.teamId * 10}`,
    buzzedAt: '2026-10-11T08:00:20.000Z',
    answerGrantedAt: null,
    answerDeadlineAt: null,
    ...p,
  };
}

function playerState(opts: { buzzes: LiveBuzzEntry[]; serverNow?: string; status?: LivePlayerState['game']['status']; qIndex?: number }): LivePlayerState {
  return {
    game: {
      id: 7,
      title: '搶答',
      status: opts.status ?? 'playing',
      gameMode: 'team_buzzer',
      currentQuestionIndex: opts.qIndex ?? 0,
      questionStartedAt: '2026-10-11T08:00:00.000Z',
      questionDuration: 20,
      totalQuestions: 3,
    },
    me: { id: 11, nickname: 'p11', score: 0, correctCount: 0, rank: 1 },
    currentQuestion: { id: 101, type: 'single_choice', body: 'Q', imageUrl: null, audioUrl: null, audioDurationSec: null, options: [] },
    myAnswer: null,
    lastResult: null,
    leaderboard: [],
    buzzer: {
      serverNow: opts.serverNow ?? NOW,
      readingMs: 3000,
      answerMs: 15000,
      teams: [
        { id: 1, name: '第 1 組', orderIndex: 0, score: 0, members: [{ id: 11, nickname: 'p11', disconnected: false }] },
        { id: 2, name: '第 2 組', orderIndex: 1, score: 0, members: [{ id: 20, nickname: 'p20', disconnected: true }] },
      ],
      myTeam: { id: 1, name: '第 1 組', score: 0 },
      buzzes: opts.buzzes,
      myStats: { buzzWonCount: 0, buzzCorrectCount: 0 },
    },
  };
}

function board(p: Partial<LiveBuzzerBoard> & Pick<LiveBuzzerBoard, 'buzzes'>): LiveBuzzerBoard {
  return {
    gameId: 7,
    questionId: 101,
    questionIndex: 0,
    status: 'playing',
    serverNow: LATER,
    teams: [
      { id: 1, name: '第 1 組', orderIndex: 0, score: -50 },
      { id: 2, name: '第 2 組', orderIndex: 1, score: 0 },
    ],
    correctAnswers: null,
    ...p,
  };
}

describe('buzzerFreshness / compareFreshness', () => {
  it('同題：多一筆搶答 / 排隊 → 作答中 / 作答中 → 答錯，都算比較新', () => {
    const f = (buzzes: LiveBuzzEntry[]) => buzzerFreshness({ questionIndex: 0, status: 'playing', buzzes, serverNow: NOW });
    const none = f([]);
    const one = f([entry({ id: 1, order: 1, teamId: 1, result: 'queued' })]);
    const granted = f([entry({ id: 1, order: 1, teamId: 1, result: 'answering' })]);
    const wrong = f([entry({ id: 1, order: 1, teamId: 1, result: 'wrong' })]);

    expect(compareFreshness(one, none)).toBeGreaterThan(0);
    expect(compareFreshness(granted, one)).toBeGreaterThan(0);
    expect(compareFreshness(wrong, granted)).toBeGreaterThan(0);
    expect(compareFreshness(none, wrong)).toBeLessThan(0);
  });

  it('換題一定比較新，即使新題還沒人搶', () => {
    const q0 = buzzerFreshness({ questionIndex: 0, status: 'showing_result', buzzes: [entry({ id: 1, order: 1, teamId: 1, result: 'correct' })], serverNow: NOW });
    const q1 = buzzerFreshness({ questionIndex: 1, status: 'playing', buzzes: [], serverNow: NOW });

    expect(compareFreshness(q1, q0)).toBeGreaterThan(0);
  });
});

describe('isStaleBuzzerState 丟掉亂序晚到的舊 state', () => {
  it('畫面已有自己的搶答（回應帶回的看板），晚到的輪詢還沒有 → 舊', () => {
    const shown = playerState({ buzzes: [entry({ id: 1, order: 1, teamId: 1, result: 'answering' })], serverNow: LATER });
    const latePoll = playerState({ buzzes: [], serverNow: NOW });

    expect(isStaleBuzzerState(shown, latePoll)).toBe(true);
    expect(isStaleBuzzerState(latePoll, shown)).toBe(false);
  });

  it('沒有前一個 state / classic 模式 → 一律接受', () => {
    const s = playerState({ buzzes: [] });

    expect(isStaleBuzzerState(null, s)).toBe(false);

    const classicA = { ...s, game: { ...s.game, gameMode: 'classic' as const }, buzzer: undefined };
    const classicB = { ...classicA, game: { ...classicA.game, currentQuestionIndex: -1 } };

    expect(isStaleBuzzerState(classicA, classicB)).toBe(false);
  });
});

describe('applyBoardToPlayerState', () => {
  it('同題較新的看板 → 套用搶答順序與組分，保留成員與我的組', () => {
    const prev = playerState({ buzzes: [entry({ id: 1, order: 1, teamId: 1, result: 'answering' })] });
    const res = applyBoardToPlayerState(prev, board({
      buzzes: [
        entry({ id: 1, order: 1, teamId: 1, result: 'wrong' }),
        entry({ id: 2, order: 2, teamId: 2, result: 'answering' }),
      ],
    }));

    expect(res.kind).toBe('applied');

    const s = (res as { state: LivePlayerState }).state;

    expect(s.buzzer!.buzzes.map(b => [b.order, b.teamName, b.result])).toEqual([
      [1, '第 1 組', 'wrong'],
      [2, '第 2 組', 'answering'],
    ]);
    expect(s.buzzer!.myTeam).toEqual({ id: 1, name: '第 1 組', score: -50 });
    expect(s.buzzer!.teams[1]!.members).toEqual([{ id: 20, nickname: 'p20', disconnected: true }]);
    expect(s.buzzer!.serverNow).toBe(LATER);
  });

  it('揭曉看板 → 狀態切到 showing_result 並帶正解', () => {
    const prev = playerState({ buzzes: [entry({ id: 1, order: 1, teamId: 1, result: 'answering' })] });
    const res = applyBoardToPlayerState(prev, board({
      status: 'showing_result',
      correctAnswers: ['b'],
      buzzes: [entry({ id: 1, order: 1, teamId: 1, result: 'correct' })],
    }));

    const s = (res as { state: LivePlayerState }).state;

    expect(s.game.status).toBe('showing_result');
    expect(s.lastResult).toEqual({ correctAnswers: ['b'], answerStats: [] });
  });

  it('比畫面舊的看板 → ignored（畫面不倒退）', () => {
    const prev = playerState({ buzzes: [entry({ id: 1, order: 1, teamId: 1, result: 'wrong' })] });

    expect(applyBoardToPlayerState(prev, board({ buzzes: [entry({ id: 1, order: 1, teamId: 1, result: 'answering' })] })))
      .toEqual({ kind: 'ignored' });
  });

  it('下一題的看板（題目內容只有 REST 有）→ refetch；上一題 / 別場 → ignored', () => {
    const prev = playerState({ buzzes: [] });

    expect(applyBoardToPlayerState(prev, board({ questionIndex: 1, questionId: 102, buzzes: [] }))).toEqual({ kind: 'refetch' });
    expect(applyBoardToPlayerState(playerState({ buzzes: [], qIndex: 1 }), board({ buzzes: [] }))).toEqual({ kind: 'ignored' });
    expect(applyBoardToPlayerState(prev, board({ gameId: 8, buzzes: [] }))).toEqual({ kind: 'ignored' });
  });

  it('還沒有 state → refetch', () => {
    expect(applyBoardToPlayerState(null, board({ buzzes: [] }))).toEqual({ kind: 'refetch' });
  });
});

describe('applyBoardToHostState', () => {
  it('保留老師端既有的所選答案欄位', () => {
    const p = playerState({ buzzes: [] });
    const host: LiveHostState = {
      game: { ...p.game, quizId: 1, gamePin: '123456', teamCount: 2 },
      players: [],
      currentQuestion: { ...p.currentQuestion!, correctAnswers: ['b'] },
      answerStats: [],
      answeredCount: 0,
      buzzer: {
        serverNow: NOW,
        readingMs: 3000,
        answerMs: 15000,
        teams: p.buzzer!.teams,
        buzzes: [{ ...entry({ id: 1, order: 1, teamId: 1, result: 'answering' }), selectedOptionId: null }],
        unassignedCount: 0,
        playerStats: [],
      },
    };
    const res = applyBoardToHostState(host, board({
      buzzes: [entry({ id: 1, order: 1, teamId: 1, result: 'wrong' }), entry({ id: 2, order: 2, teamId: 2, result: 'queued' })],
    }));
    const s = (res as { state: LiveHostState }).state;

    expect(s.buzzer!.buzzes.map(b => [b.order, b.result, b.selectedOptionId])).toEqual([
      [1, 'wrong', null],
      [2, 'queued', null],
    ]);
    expect(s.buzzer!.teams.map(t => t.score)).toEqual([-50, 0]);
  });
});

describe('msUntilAnswerDeadline', () => {
  it('作答中：截止 08:00:40，server 現在 08:00:30 → 10_000ms', () => {
    const s = playerState({
      buzzes: [entry({ id: 1, order: 1, teamId: 1, result: 'answering', answerGrantedAt: '2026-10-11T08:00:25.000Z', answerDeadlineAt: '2026-10-11T08:00:40.000Z' })],
    });

    expect(msUntilAnswerDeadline(s)).toBe(10_000);
  });

  it('沒有作答中的組 / 已揭曉 → null', () => {
    expect(msUntilAnswerDeadline(playerState({ buzzes: [] }))).toBeNull();
    expect(msUntilAnswerDeadline(playerState({ status: 'showing_result', buzzes: [] }))).toBeNull();
  });
});
