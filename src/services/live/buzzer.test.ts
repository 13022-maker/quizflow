// 小組搶答狀態機（純函式）測試：期望值全部手算，算式寫在註解
import { describe, expect, it } from 'vitest';

import {
  assignTeamsByCount,
  type BuzzState,
  checkAnswerAllowed,
  checkBuzzAllowed,
  derivePlayerBuzzPhase,
  isBuzzerSupportedType,
  pickTeamForLateJoiner,
  planReconcile,
  scoreDeltaFor,
  sortBuzzes,
} from './buzzer';

// 題目在 t=10_000ms 開始；看題倒數 3 秒 → t=13_000 才開放搶答
const Q_START = 10_000;

function buzz(partial: Partial<BuzzState> & Pick<BuzzState, 'id' | 'teamId'>): BuzzState {
  return {
    playerId: partial.teamId * 10,
    buzzedAtMs: 13_500,
    result: 'queued',
    answerGrantedAtMs: null,
    ...partial,
  };
}

describe('checkBuzzAllowed 搶答資格', () => {
  it('看題倒數 3 秒內一律拒絕（12_999 = 開始後 2.999 秒）', () => {
    const r = checkBuzzAllowed({ status: 'playing', questionStartedAtMs: Q_START, nowMs: 12_999, teamId: 1, buzzes: [] });

    expect(r).toEqual({ ok: false, reason: 'READING' });
  });

  it('剛好滿 3 秒（13_000 = 10_000 + 3_000）開放搶答', () => {
    const r = checkBuzzAllowed({ status: 'playing', questionStartedAtMs: Q_START, nowMs: 13_000, teamId: 1, buzzes: [] });

    expect(r).toEqual({ ok: true });
  });

  it('同組第二人再按 → ALREADY_BUZZED', () => {
    const r = checkBuzzAllowed({
      status: 'playing',
      questionStartedAtMs: Q_START,
      nowMs: 14_000,
      teamId: 1,
      buzzes: [buzz({ id: 1, teamId: 1 })],
    });

    expect(r).toEqual({ ok: false, reason: 'ALREADY_BUZZED' });
  });

  it('已答錯的組不能再搶同一題', () => {
    const r = checkBuzzAllowed({
      status: 'playing',
      questionStartedAtMs: Q_START,
      nowMs: 20_000,
      teamId: 1,
      buzzes: [buzz({ id: 1, teamId: 1, result: 'wrong', answerGrantedAtMs: 13_500 })],
    });

    expect(r).toEqual({ ok: false, reason: 'ALREADY_BUZZED' });
  });

  it('沒分組、非 playing、已有組答對 都拒絕', () => {
    expect(checkBuzzAllowed({ status: 'playing', questionStartedAtMs: Q_START, nowMs: 14_000, teamId: null, buzzes: [] }))
      .toEqual({ ok: false, reason: 'NO_TEAM' });
    expect(checkBuzzAllowed({ status: 'showing_result', questionStartedAtMs: Q_START, nowMs: 14_000, teamId: 1, buzzes: [] }))
      .toEqual({ ok: false, reason: 'NOT_PLAYING' });
    expect(checkBuzzAllowed({
      status: 'playing',
      questionStartedAtMs: Q_START,
      nowMs: 14_000,
      teamId: 2,
      buzzes: [buzz({ id: 1, teamId: 1, result: 'correct', answerGrantedAtMs: 13_500 })],
    })).toEqual({ ok: false, reason: 'QUESTION_CLOSED' });
  });
});

describe('sortBuzzes 搶答順序', () => {
  it('依 server 收到時間排序，與 id / 陣列順序無關；同毫秒才用 id 決勝', () => {
    const sorted = sortBuzzes([
      buzz({ id: 1, teamId: 3, buzzedAtMs: 13_900 }),
      buzz({ id: 2, teamId: 1, buzzedAtMs: 13_100 }),
      buzz({ id: 4, teamId: 2, buzzedAtMs: 13_500 }),
      buzz({ id: 3, teamId: 4, buzzedAtMs: 13_500 }),
    ]);

    expect(sorted.map(b => b.teamId)).toEqual([1, 4, 2, 3]);
  });
});

describe('planReconcile 作答權流轉', () => {
  it('沒人持有作答權 → 最早搶到的組取得作答權，從現在起算', () => {
    const steps = planReconcile({
      teamIds: [1, 2, 3],
      nowMs: 13_600,
      buzzes: [buzz({ id: 2, teamId: 2, buzzedAtMs: 13_550 }), buzz({ id: 1, teamId: 1, buzzedAtMs: 13_500 })],
    });

    expect(steps).toEqual([{ kind: 'grant', buzzId: 1, grantedAtMs: 13_600 }]);
  });

  it('作答中且未逾時 → 不動', () => {
    const steps = planReconcile({
      teamIds: [1, 2],
      nowMs: 28_499, // 13_500 + 15_000 = 28_500 才逾時
      buzzes: [buzz({ id: 1, teamId: 1, result: 'answering', answerGrantedAtMs: 13_500 }), buzz({ id: 2, teamId: 2 })],
    });

    expect(steps).toEqual([]);
  });

  it('逾時（滿 15 秒）＝答錯 −50，作答權交給排隊的下一組', () => {
    const steps = planReconcile({
      teamIds: [1, 2, 3],
      nowMs: 28_500, // 13_500 + 15_000
      buzzes: [
        buzz({ id: 1, teamId: 1, result: 'answering', answerGrantedAtMs: 13_500 }),
        buzz({ id: 3, teamId: 3, buzzedAtMs: 14_000 }),
        buzz({ id: 2, teamId: 2, buzzedAtMs: 13_800 }),
      ],
    });

    expect(steps).toEqual([
      { kind: 'timeout', buzzId: 1, teamId: 1, delta: -50 },
      { kind: 'grant', buzzId: 2, grantedAtMs: 28_500 },
    ]);
  });

  it('答錯後沒有排隊的組 → 回到開放搶答（不產生任何步驟）', () => {
    const steps = planReconcile({
      teamIds: [1, 2, 3],
      nowMs: 20_000,
      buzzes: [buzz({ id: 1, teamId: 1, result: 'wrong', answerGrantedAtMs: 13_500 })],
    });

    expect(steps).toEqual([]);
  });

  it('逾時後沒有排隊、但還有組沒搶過 → 只記逾時，題目繼續開放', () => {
    const steps = planReconcile({
      teamIds: [1, 2],
      nowMs: 30_000,
      buzzes: [buzz({ id: 1, teamId: 1, result: 'answering', answerGrantedAtMs: 13_500 })],
    });

    expect(steps).toEqual([{ kind: 'timeout', buzzId: 1, teamId: 1, delta: -50 }]);
  });

  it('全組都答錯（含逾時）→ close 進入揭曉', () => {
    const steps = planReconcile({
      teamIds: [1, 2, 3],
      nowMs: 60_000,
      buzzes: [
        buzz({ id: 1, teamId: 1, result: 'wrong', answerGrantedAtMs: 13_500 }),
        buzz({ id: 2, teamId: 2, result: 'timeout', answerGrantedAtMs: 15_000 }),
        buzz({ id: 3, teamId: 3, result: 'answering', answerGrantedAtMs: 40_000 }), // 40_000 + 15_000 = 55_000 ≤ 60_000 → 逾時
      ],
    });

    expect(steps).toEqual([
      { kind: 'timeout', buzzId: 3, teamId: 3, delta: -50 },
      { kind: 'close' },
    ]);
  });

  it('已有組答對 → close（不再發作答權給排隊的組）', () => {
    const steps = planReconcile({
      teamIds: [1, 2],
      nowMs: 20_000,
      buzzes: [
        buzz({ id: 1, teamId: 1, result: 'correct', answerGrantedAtMs: 13_500 }),
        buzz({ id: 2, teamId: 2 }),
      ],
    });

    expect(steps).toEqual([{ kind: 'close' }]);
  });
});

describe('checkAnswerAllowed 誰能送出答案', () => {
  const buzzes = [
    buzz({ id: 1, teamId: 1, playerId: 11, result: 'answering', answerGrantedAtMs: 13_500 }),
    buzz({ id: 2, teamId: 2, playerId: 21 }),
  ];

  it('按下搶答的那位學生可以作答', () => {
    const r = checkAnswerAllowed({ buzzes, playerId: 11, teamId: 1, nowMs: 20_000 });

    expect(r).toEqual({ ok: true, buzzId: 1 });
  });

  it('同組隊友不能代答', () => {
    const r = checkAnswerAllowed({ buzzes, playerId: 12, teamId: 1, nowMs: 20_000 });

    expect(r).toEqual({ ok: false, reason: 'TEAMMATE_ANSWERING' });
  });

  it('排隊中的組不能搶先作答', () => {
    const r = checkAnswerAllowed({ buzzes, playerId: 21, teamId: 2, nowMs: 20_000 });

    expect(r).toEqual({ ok: false, reason: 'NOT_YOUR_TURN' });
  });

  it('超過 15 秒才送出 → TIMEOUT（28_500 = 13_500 + 15_000）', () => {
    const r = checkAnswerAllowed({ buzzes, playerId: 11, teamId: 1, nowMs: 28_500 });

    expect(r).toEqual({ ok: false, reason: 'TIMEOUT' });
  });
});

describe('scoreDeltaFor 計分', () => {
  it('答對 +100、答錯 −50、逾時 −50、其他 0', () => {
    expect(scoreDeltaFor('correct')).toBe(100);
    expect(scoreDeltaFor('wrong')).toBe(-50);
    expect(scoreDeltaFor('timeout')).toBe(-50);
    expect(scoreDeltaFor('queued')).toBe(0);
    expect(scoreDeltaFor('answering')).toBe(0);
  });

  it('一組答錯一次 + 答對一次：−50 + 100 = 50', () => {
    expect(scoreDeltaFor('wrong') + scoreDeltaFor('correct')).toBe(50);
  });
});

describe('assignTeamsByCount 分組', () => {
  it('依加入順序 round-robin：7 人分 3 組 → [1,4,7] [2,5] [3,6]', () => {
    expect(assignTeamsByCount([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 4, 7], [2, 5], [3, 6]]);
  });

  it('人數少於組數 → 組數縮成人數（2 人選 4 組 → 2 組各 1 人）', () => {
    expect(assignTeamsByCount([8, 9], 4)).toEqual([[8], [9]]);
  });

  it('沒有人 → 空陣列', () => {
    expect(assignTeamsByCount([], 4)).toEqual([]);
  });
});

describe('pickTeamForLateJoiner 後加入補位', () => {
  it('補進人數最少的組', () => {
    expect(pickTeamForLateJoiner([
      { id: 10, orderIndex: 0, memberCount: 3 },
      { id: 11, orderIndex: 1, memberCount: 2 },
      { id: 12, orderIndex: 2, memberCount: 3 },
    ])).toBe(11);
  });

  it('同人數取組號小的（orderIndex 小者），與陣列順序無關', () => {
    expect(pickTeamForLateJoiner([
      { id: 12, orderIndex: 2, memberCount: 2 },
      { id: 10, orderIndex: 0, memberCount: 3 },
      { id: 11, orderIndex: 1, memberCount: 2 },
    ])).toBe(11);
  });

  it('還沒分組 → null', () => {
    expect(pickTeamForLateJoiner([])).toBeNull();
  });
});

describe('isBuzzerSupportedType 題型', () => {
  it('單選／複選／是非可用，聽力題與其他排除', () => {
    expect(['single_choice', 'multiple_choice', 'true_false', 'listening', 'short_answer'].map(isBuzzerSupportedType))
      .toEqual([true, true, true, false, false]);
  });
});

describe('derivePlayerBuzzPhase 學生端畫面狀態', () => {
  const base = {
    status: 'playing' as const,
    questionStartedAtMs: Q_START,
    myTeamId: 1,
    myPlayerId: 11,
  };
  const entry = (p: { teamId: number; playerId: number; result: BuzzState['result']; answerGrantedAtMs?: number | null; order: number }) => ({
    teamId: p.teamId,
    teamName: `第 ${p.teamId} 組`,
    playerId: p.playerId,
    nickname: `p${p.playerId}`,
    result: p.result,
    answerGrantedAtMs: p.answerGrantedAtMs ?? null,
    order: p.order,
  });

  it('看題中：剩 2 秒（11_000 → 13_000 - 11_000 = 2_000ms）', () => {
    expect(derivePlayerBuzzPhase({ ...base, nowMs: 11_000, buzzes: [] })).toEqual({ kind: 'reading', secondsLeft: 2 });
  });

  it('開放搶答', () => {
    expect(derivePlayerBuzzPhase({ ...base, nowMs: 13_000, buzzes: [] })).toEqual({ kind: 'open' });
  });

  it('我搶到、我是作答者：剩 10 秒（14_000 + 15_000 - 19_000）', () => {
    const phase = derivePlayerBuzzPhase({
      ...base,
      nowMs: 19_000,
      buzzes: [entry({ teamId: 1, playerId: 11, result: 'answering', answerGrantedAtMs: 14_000, order: 1 })],
    });

    expect(phase).toEqual({ kind: 'answering_me', secondsLeft: 10 });
  });

  it('隊友搶到 → 顯示隊友名字', () => {
    const phase = derivePlayerBuzzPhase({
      ...base,
      nowMs: 19_000,
      buzzes: [entry({ teamId: 1, playerId: 12, result: 'answering', answerGrantedAtMs: 14_000, order: 1 })],
    });

    expect(phase).toEqual({ kind: 'answering_teammate', nickname: 'p12', secondsLeft: 10 });
  });

  it('他組作答中、我組還沒搶 → 可以排隊搶', () => {
    const phase = derivePlayerBuzzPhase({
      ...base,
      nowMs: 19_000,
      buzzes: [entry({ teamId: 2, playerId: 21, result: 'answering', answerGrantedAtMs: 14_000, order: 1 })],
    });

    expect(phase).toEqual({ kind: 'other_team_answering', teamName: '第 2 組', canBuzz: true });
  });

  it('我組已搶、排隊第 2（前面還有 1 組在排）', () => {
    const phase = derivePlayerBuzzPhase({
      ...base,
      nowMs: 19_000,
      buzzes: [
        entry({ teamId: 2, playerId: 21, result: 'answering', answerGrantedAtMs: 14_000, order: 1 }),
        entry({ teamId: 3, playerId: 31, result: 'queued', order: 2 }),
        entry({ teamId: 1, playerId: 12, result: 'queued', order: 3 }),
      ],
    });

    expect(phase).toEqual({ kind: 'queued', position: 2, answeringTeamName: '第 2 組' });
  });

  it('我組已答錯 → my_team_failed', () => {
    const phase = derivePlayerBuzzPhase({
      ...base,
      nowMs: 30_000,
      buzzes: [entry({ teamId: 1, playerId: 11, result: 'timeout', answerGrantedAtMs: 14_000, order: 1 })],
    });

    expect(phase).toEqual({ kind: 'my_team_failed' });
  });

  it('揭曉階段 / 沒分組', () => {
    expect(derivePlayerBuzzPhase({ ...base, status: 'showing_result', nowMs: 30_000, buzzes: [] })).toEqual({ kind: 'revealed' });
    expect(derivePlayerBuzzPhase({ ...base, myTeamId: null, nowMs: 30_000, buzzes: [] })).toEqual({ kind: 'no_team' });
  });
});
