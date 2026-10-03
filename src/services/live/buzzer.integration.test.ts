// 小組搶答整合測試：真實 liveStore / buzzerStore + 全部 migration（無 DATABASE_URL 時 src/libs/DB.ts
// 自動用 in-memory PGlite）。時間推進一律用 SQL 把 timestamp 往回撥（DB 時鐘），不 sleep。
// 分數期望值全部手算，算式寫在註解。
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import {
  createLiveGame,
  nextQuestion,
  nextTeamBuzzerQuestion,
  revealTeamBuzzerAnswer,
  showResult,
  startGame,
  startTeamBuzzerGame,
} from '@/actions/liveActions';
import { db } from '@/libs/DB';
import {
  liveBuzzSchema,
  liveGameSchema,
  livePlayerSchema,
  questionSchema,
  quizSchema,
} from '@/models/Schema';

import { assignLateJoiner, recordBuzz, recordBuzzAnswer } from './buzzerStore';
import { getHostState, getPlayerState, recordAnswer } from './liveStore';

// Server Action 需要 Clerk 身分：固定回傳測試老師
vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: 'user_buzzer_test' }),
}));

const HOST = 'user_buzzer_test';
let pinSeq = 0;

async function seedQuiz(types: ('single_choice' | 'true_false' | 'listening' | 'multiple_choice')[]) {
  const [quiz] = await db.insert(quizSchema).values({ ownerId: HOST, title: '搶答測驗', status: 'published' }).returning();
  const questions = await db.insert(questionSchema).values(types.map((type, i) => ({
    quizId: quiz!.id,
    type,
    body: `第 ${i + 1} 題（${type}）`,
    options: type === 'true_false'
      ? [{ id: 'tf-true', text: '正確' }, { id: 'tf-false', text: '錯誤' }]
      : [{ id: 'a', text: '甲' }, { id: 'b', text: '乙' }, { id: 'c', text: '丙' }],
    correctAnswers: type === 'true_false' ? ['tf-true'] : type === 'multiple_choice' ? ['a', 'c'] : ['b'],
    audioUrl: type === 'listening' ? 'https://example.com/a.mp3' : null,
    position: i,
  }))).returning();
  return { quizId: quiz!.id, questionIds: questions.map(q => q.id) };
}

async function seedGame(quizId: number, gameMode: 'classic' | 'team_buzzer', playerCount: number) {
  pinSeq += 1;
  const [game] = await db.insert(liveGameSchema).values({
    quizId,
    hostUserId: HOST,
    title: '搶答測驗',
    gamePin: `B${String(pinSeq).padStart(5, '0')}`,
    gameMode,
    teamCount: gameMode === 'team_buzzer' ? 3 : null,
  }).returning();
  const players = [];
  for (let i = 0; i < playerCount; i++) {
    // 逐一 insert，確保 joinedAt / id 依加入順序遞增
    const [p] = await db.insert(livePlayerSchema).values({
      gameId: game!.id,
      nickname: `p${i + 1}`,
      playerToken: `tok-${game!.id}-${i}`,
    }).returning();
    players.push(p!.id);
  }
  return { gameId: game!.id, players };
}

// 把題目開始時間往回撥 N 秒（模擬看題倒數已過）
async function rewindQuestionStart(gameId: number, seconds: number) {
  await db.update(liveGameSchema)
    .set({ questionStartedAt: sql`${liveGameSchema.questionStartedAt} - make_interval(secs => ${seconds})` })
    .where(eq(liveGameSchema.id, gameId));
}

// 把目前作答組的取得作答權時間往回撥 N 秒（模擬作答逾時）
async function rewindAnswering(gameId: number, seconds: number) {
  await db.update(liveBuzzSchema)
    .set({ answerGrantedAt: sql`${liveBuzzSchema.answerGrantedAt} - make_interval(secs => ${seconds})` })
    .where(and(eq(liveBuzzSchema.gameId, gameId), eq(liveBuzzSchema.result, 'answering')));
}

async function teamScores(gameId: number) {
  const host = await getHostState(gameId);
  return host!.buzzer!.teams.map(t => t.score);
}

describe('小組搶答完整場景（整合）', () => {
  it('3 組：第 1 組答錯、第 2 組逾時、第 3 組答對 → −50 / −50 / +100', async () => {
    // 第 2 題是聽力題，搶答模式要排除 → 實際只有 2 題
    const { quizId, questionIds } = await seedQuiz(['single_choice', 'listening', 'true_false']);
    const [q1, , q3] = questionIds as [number, number, number];
    const { gameId, players } = await seedGame(quizId, 'team_buzzer', 6);
    const [p1, p2, p3, p4] = players as [number, number, number, number, number, number];

    // 老師在大廳把組數維持 3 → 分組並開始
    expect(await startTeamBuzzerGame(gameId, 3)).toEqual({ ok: true });

    const host0 = await getHostState(gameId);

    expect(host0!.game.gameMode).toBe('team_buzzer');
    expect(host0!.game.status).toBe('playing');
    expect(host0!.game.totalQuestions).toBe(2);
    expect(host0!.currentQuestion!.id).toBe(q1);
    // round-robin：p1,p4 → 第 1 組；p2,p5 → 第 2 組；p3,p6 → 第 3 組
    expect(host0!.buzzer!.teams.map(t => [t.name, t.members.map(m => m.nickname)])).toEqual([
      ['第 1 組', ['p1', 'p4']],
      ['第 2 組', ['p2', 'p5']],
      ['第 3 組', ['p3', 'p6']],
    ]);

    // 看題倒數 3 秒內按搶答 → 拒絕
    const early = await recordBuzz({ gameId, playerId: p1, questionId: q1 });

    expect(early).toMatchObject({ ok: false, code: 'READING' });

    await rewindQuestionStart(gameId, 4);

    // p1（第 1 組）先搶 → 立刻取得作答權
    expect(await recordBuzz({ gameId, playerId: p1, questionId: q1 })).toMatchObject({ ok: true, order: 1, granted: true });

    // 同組隊友 p4 再按 → 你的組已經搶過了
    const dup = await recordBuzz({ gameId, playerId: p4, questionId: q1 });

    expect(dup).toMatchObject({ ok: false, code: 'ALREADY_BUZZED', message: '你的組已經搶過了' });

    // 第 2、3 組排隊
    expect(await recordBuzz({ gameId, playerId: p2, questionId: q1 })).toMatchObject({ ok: true, order: 2, granted: false });
    expect(await recordBuzz({ gameId, playerId: p3, questionId: q1 })).toMatchObject({ ok: true, order: 3, granted: false });

    // 學生端拿到的 state 不含正解
    const ps = await getPlayerState(gameId, p2);

    expect(ps!.game.gameMode).toBe('team_buzzer');
    expect(ps!.lastResult).toBeNull();
    expect(JSON.stringify(ps)).not.toContain('correctAnswers');
    expect(ps!.buzzer!.myTeam!.name).toBe('第 2 組');
    expect(ps!.buzzer!.buzzes.map(b => [b.order, b.teamName, b.result])).toEqual([
      [1, '第 1 組', 'answering'],
      [2, '第 2 組', 'queued'],
      [3, '第 3 組', 'queued'],
    ]);

    // 隊友不能代答、排隊的組不能搶先答
    expect(await recordBuzzAnswer({ gameId, playerId: p4, questionId: q1, selectedOptionId: 'b' }))
      .toMatchObject({ ok: false, code: 'TEAMMATE_ANSWERING' });
    expect(await recordBuzzAnswer({ gameId, playerId: p2, questionId: q1, selectedOptionId: 'b' }))
      .toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });

    // 第 1 組答錯（選 a，正解 b）→ −50，作答權交給第 2 組
    expect(await recordBuzzAnswer({ gameId, playerId: p1, questionId: q1, selectedOptionId: 'a' }))
      .toMatchObject({ ok: true, isCorrect: false });

    const afterWrong = await getHostState(gameId);

    expect(afterWrong!.buzzer!.buzzes.map(b => b.result)).toEqual(['wrong', 'answering', 'queued']);

    // 第 2 組 15 秒內沒作答 → 下一次讀取時 lazy 判定逾時（−50），作答權交給第 3 組
    await rewindAnswering(gameId, 16);
    const afterTimeout = await getPlayerState(gameId, p3);

    expect(afterTimeout!.buzzer!.buzzes.map(b => b.result)).toEqual(['wrong', 'timeout', 'answering']);

    // 第 2 組逾時後才送出 → 拒絕
    expect(await recordBuzzAnswer({ gameId, playerId: p2, questionId: q1, selectedOptionId: 'b' }))
      .toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });

    // 第 3 組答對 → +100，自動進入揭曉
    expect(await recordBuzzAnswer({ gameId, playerId: p3, questionId: q1, selectedOptionId: 'b' }))
      .toMatchObject({ ok: true, isCorrect: true });

    // 第 1 組 0−50=−50；第 2 組 0−50=−50；第 3 組 0+100=100
    expect(await teamScores(gameId)).toEqual([-50, -50, 100]);

    const revealed = await getPlayerState(gameId, p1);

    expect(revealed!.game.status).toBe('showing_result');
    expect(revealed!.lastResult!.correctAnswers).toEqual(['b']);

    // 揭曉後再按搶答 → 不是搶答時間
    expect(await recordBuzz({ gameId, playerId: p1, questionId: q1 })).toMatchObject({ ok: false, code: 'NOT_PLAYING' });

    // 分組後才加入的 p7：三組都 2 人 → 補進組號最小的第 1 組
    const [p7] = await db.insert(livePlayerSchema).values({ gameId, nickname: 'p7', playerToken: `tok-${gameId}-late` }).returning();
    await assignLateJoiner(gameId, p7!.id);
    const late = await getPlayerState(gameId, p7!.id);

    expect(late!.buzzer!.myTeam!.name).toBe('第 1 組');

    // 下一題（跳過聽力題 → 是非題 q3），老師主導節奏：不會自動推進
    expect(await nextTeamBuzzerQuestion(gameId)).toEqual({ ok: true, finished: false });

    const host2 = await getHostState(gameId);

    expect(host2!.game.status).toBe('playing');
    expect(host2!.currentQuestion!.id).toBe(q3);
    expect(host2!.buzzer!.buzzes).toEqual([]);

    // 揭曉答案（沒人答對也可以）→ 最後一題按下一題 → 結束
    expect(await revealTeamBuzzerAnswer(gameId)).toEqual({ ok: true });
    expect(await nextTeamBuzzerQuestion(gameId)).toEqual({ ok: true, finished: true });

    const final = await getPlayerState(gameId, p3);

    expect(final!.game.status).toBe('finished');
    expect(final!.buzzer!.teams.map(t => [t.name, t.score])).toEqual([
      ['第 1 組', -50],
      ['第 2 組', -50],
      ['第 3 組', 100],
    ]);

    // 個人報表：搶到（取得作答權）次數 / 答對次數
    const finalHost = await getHostState(gameId);
    const stat = (id: number) => finalHost!.buzzer!.playerStats.find(s => s.playerId === id);

    expect(stat(p1)).toMatchObject({ buzzWonCount: 1, buzzCorrectCount: 0 });
    expect(stat(p2)).toMatchObject({ buzzWonCount: 1, buzzCorrectCount: 0 });
    expect(stat(p3)).toMatchObject({ buzzWonCount: 1, buzzCorrectCount: 1 });
    expect(stat(p4)).toMatchObject({ buzzWonCount: 0, buzzCorrectCount: 0 });
  });

  it('同時搶答：多組幾乎同時按下，只有一組取得作答權，其餘依序排隊', async () => {
    const { quizId, questionIds } = await seedQuiz(['multiple_choice']);
    const { gameId, players } = await seedGame(quizId, 'team_buzzer', 4);
    await startTeamBuzzerGame(gameId, 4);
    await rewindQuestionStart(gameId, 4);

    const results = await Promise.all(players.map(playerId => recordBuzz({ gameId, playerId, questionId: questionIds[0]! })));

    expect(results.every(r => r.ok)).toBe(true);

    const host = await getHostState(gameId);
    const answering = host!.buzzer!.buzzes.filter(b => b.result === 'answering');

    expect(answering).toHaveLength(1);
    expect(host!.buzzer!.buzzes.map(b => b.order)).toEqual([1, 2, 3, 4]);
    expect(answering[0]!.order).toBe(1);
  });

  it('全組答錯 → 自動揭曉；複選題要全對才算對', async () => {
    const { quizId, questionIds } = await seedQuiz(['multiple_choice']);
    const q = questionIds[0]!;
    const { gameId, players } = await seedGame(quizId, 'team_buzzer', 2);
    const [a, b] = players as [number, number];
    await startTeamBuzzerGame(gameId, 2);
    await rewindQuestionStart(gameId, 4);

    await recordBuzz({ gameId, playerId: a, questionId: q });

    // 正解 [a, c]，只選 a → 錯
    expect(await recordBuzzAnswer({ gameId, playerId: a, questionId: q, selectedOptionId: ['a'] })).toMatchObject({ ok: true, isCorrect: false });

    // 沒人排隊 → 回到開放搶答，題目仍在進行
    expect((await getHostState(gameId))!.game.status).toBe('playing');

    await recordBuzz({ gameId, playerId: b, questionId: q });

    expect(await recordBuzzAnswer({ gameId, playerId: b, questionId: q, selectedOptionId: ['c'] })).toMatchObject({ ok: true, isCorrect: false });

    const host = await getHostState(gameId);

    expect(host!.game.status).toBe('showing_result');
    // 兩組各 −50
    expect(host!.buzzer!.teams.map(t => t.score)).toEqual([-50, -50]);
  });
});

describe('建立遊戲與模式隔離（整合）', () => {
  it('搶答模式但只有聽力題 → 繁中錯誤；經典模式同一份測驗可以建立', async () => {
    const { quizId } = await seedQuiz(['listening']);

    const buzzer = await createLiveGame({ quizId, gameMode: 'team_buzzer', teamCount: 4 });

    expect(buzzer).toEqual({ error: '此測驗沒有可用於小組搶答的題目（僅支援單選、複選、是非題，聽力題不適用）' });

    const classic = await createLiveGame({ quizId });

    expect(classic).toMatchObject({ ok: true });
  });

  it('搶答模式建立時寫入 gameMode / teamCount；組數超出 2–8 被擋', async () => {
    const { quizId } = await seedQuiz(['single_choice']);
    const res = await createLiveGame({ quizId, gameMode: 'team_buzzer', teamCount: 5 });

    expect(res).toMatchObject({ ok: true });

    const [row] = await db.select().from(liveGameSchema).where(eq(liveGameSchema.id, (res as { gameId: number }).gameId));

    expect([row!.gameMode, row!.teamCount]).toEqual(['team_buzzer', 5]);
    expect(await createLiveGame({ quizId, gameMode: 'team_buzzer', teamCount: 9 })).toHaveProperty('error');
  });

  it('經典模式回歸：開始 → 作答計分 → 揭曉 → 結束，回應不帶 buzzer 欄位、不能搶答', async () => {
    const { quizId, questionIds } = await seedQuiz(['single_choice']);
    const { gameId, players } = await seedGame(quizId, 'classic', 2);
    const [p1, p2] = players as [number, number];

    expect(await startGame(gameId)).toEqual({ ok: true });

    const host = await getHostState(gameId);

    expect(host!.game.status).toBe('playing');
    expect(host!.game.gameMode).toBe('classic');
    expect(host).not.toHaveProperty('buzzer');

    // 經典計分：答對且 responseMs≈0 → 1000 × (1 − 0×0.5) = 1000（允許幾毫秒誤差：最低 500，實際應 > 990）
    const r1 = await recordAnswer({ gameId, playerId: p1, questionId: questionIds[0]!, selectedOptionId: 'b' });

    expect(r1.ok && r1.isCorrect).toBe(true);
    expect(r1.ok && r1.score).toBeGreaterThan(990);

    const r2 = await recordAnswer({ gameId, playerId: p2, questionId: questionIds[0]!, selectedOptionId: 'a' });

    expect(r2).toEqual({ ok: true, isCorrect: false, score: 0 });

    // 經典模式不能搶答
    expect(await recordBuzz({ gameId, playerId: p1, questionId: questionIds[0]! })).toMatchObject({ ok: false, code: 'WRONG_MODE' });

    expect(await showResult(gameId)).toEqual({ ok: true });

    const ps = await getPlayerState(gameId, p1);

    expect(ps!.game.status).toBe('showing_result');
    expect(ps!.lastResult!.correctAnswers).toEqual(['b']);
    expect(ps).not.toHaveProperty('buzzer');

    expect(await nextQuestion(gameId)).toEqual({ ok: true, finished: true });
    expect((await getPlayerState(gameId, p1))!.leaderboard.map(p => p.nickname)).toEqual(['p1', 'p2']);
  });

  it('搶答模式的遊戲不能用經典作答 API / 經典開始動作', async () => {
    const { quizId, questionIds } = await seedQuiz(['single_choice']);
    const { gameId, players } = await seedGame(quizId, 'team_buzzer', 2);

    expect(await startGame(gameId)).toHaveProperty('error');

    await startTeamBuzzerGame(gameId, 2);

    expect(await recordAnswer({ gameId, playerId: players[0]!, questionId: questionIds[0]!, selectedOptionId: 'b' }))
      .toMatchObject({ ok: false, error: 'WRONG_MODE' });

    // 搶答模式不走經典自動推進：題目開始很久之後讀取仍停在 playing
    await rewindQuestionStart(gameId, 600);

    expect((await getHostState(gameId))!.game.status).toBe('playing');
  });
});
