// 暫時的壓力測試（不 commit）：只在設了 DATABASE_URL（真的 PostgreSQL、Pool 多連線）時有意義。
// 多個請求同時搶答、同時讀取（觸發 lazy 逾時/發作答權），檢查不變量。
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { startTeamBuzzerGame } from '@/actions/liveActions';
import { db } from '@/libs/DB';
import { liveBuzzSchema, liveGameSchema, livePlayerSchema, liveTeamSchema, questionSchema, quizSchema } from '@/models/Schema';

import { recordBuzz, recordBuzzAnswer } from './buzzerStore';
import { getHostState, getPlayerState } from './liveStore';

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'stress_host' }) }));

const TEAMS = 8;
const PLAYERS = 24;

async function invariants(gameId: number, questionId: number) {
  const buzzes = await db.select().from(liveBuzzSchema).where(and(eq(liveBuzzSchema.gameId, gameId), eq(liveBuzzSchema.questionId, questionId)));
  const answering = buzzes.filter(b => b.result === 'answering').length;
  const correct = buzzes.filter(b => b.result === 'correct').length;
  const teamsBuzzed = new Set(buzzes.map(b => b.teamId));
  const teams = await db.select().from(liveTeamSchema).where(eq(liveTeamSchema.gameId, gameId));
  // 每組分數 = 該組所有 buzz 的計分總和（+100 / −50）
  const allBuzzes = await db.select().from(liveBuzzSchema).where(eq(liveBuzzSchema.gameId, gameId));
  for (const t of teams) {
    const expected = allBuzzes.filter(b => b.teamId === t.id)
      .reduce((s, b) => s + (b.result === 'correct' ? 100 : (b.result === 'wrong' || b.result === 'timeout') ? -50 : 0), 0);

    expect(t.score, `team ${t.name} score`).toBe(expected);
  }

  expect(answering).toBeLessThanOrEqual(1);
  expect(correct).toBeLessThanOrEqual(1);
  expect(teamsBuzzed.size).toBe(buzzes.length);
}

describe.runIf(!!process.env.DATABASE_URL)('小組搶答真實 PostgreSQL 併發壓力', () => {
  it('24 人 8 組同時搶答＋同時讀取＋同時作答，重複 15 輪不變量都成立', async () => {
    for (let round = 0; round < 15; round++) {
      const [quiz] = await db.insert(quizSchema).values({ ownerId: 'stress_host', title: 'stress', status: 'published' }).returning();
      const [q] = await db.insert(questionSchema).values({
        quizId: quiz!.id,
        type: 'single_choice',
        body: '題',
        options: [{ id: 'a', text: '甲' }, { id: 'b', text: '乙' }],
        correctAnswers: ['b'],
        position: 0,
      }).returning();
      const [game] = await db.insert(liveGameSchema).values({
        quizId: quiz!.id,
        hostUserId: 'stress_host',
        title: 'stress',
        gamePin: `S${Date.now().toString(36).slice(-4)}${round}`.slice(0, 6).toUpperCase(),
        gameMode: 'team_buzzer',
        teamCount: TEAMS,
      }).returning();
      const players: number[] = [];
      for (let i = 0; i < PLAYERS; i++) {
        const [p] = await db.insert(livePlayerSchema).values({ gameId: game!.id, nickname: `p${i}`, playerToken: `st-${game!.id}-${i}` }).returning();
        players.push(p!.id);
      }

      expect(await startTeamBuzzerGame(game!.id, TEAMS)).toEqual({ ok: true });

      await db.update(liveGameSchema).set({ questionStartedAt: sql`${liveGameSchema.questionStartedAt} - make_interval(secs => 5)` }).where(eq(liveGameSchema.id, game!.id));

      // 全部 24 人同時搶答（每組 3 人互搶）+ 同時大量讀取
      const results = await Promise.all([
        ...players.map(pid => recordBuzz({ gameId: game!.id, playerId: pid, questionId: q!.id })),
        ...players.map(pid => getPlayerState(game!.id, pid)),
        getHostState(game!.id),
      ]);
      const buzzResults = results.slice(0, PLAYERS) as Awaited<ReturnType<typeof recordBuzz>>[];

      expect(buzzResults.filter(r => r.ok).length).toBe(TEAMS);
      expect(buzzResults.filter(r => r.ok && r.granted).length).toBe(1);

      await invariants(game!.id, q!.id);

      // 回合：把作答者時間往回撥製造逾時，同時一堆讀取 + 作答者同時送錯答案
      for (let step = 0; step < TEAMS; step++) {
        const [ans] = await db.select().from(liveBuzzSchema).where(and(eq(liveBuzzSchema.gameId, game!.id), eq(liveBuzzSchema.result, 'answering')));
        if (!ans) {
          break;
        }
        if (step % 2 === 0) {
          await db.update(liveBuzzSchema).set({ answerGrantedAt: sql`${liveBuzzSchema.answerGrantedAt} - make_interval(secs => 20)` }).where(eq(liveBuzzSchema.id, ans.id));
          await Promise.all([
            ...players.slice(0, 10).map(pid => getPlayerState(game!.id, pid)),
            recordBuzzAnswer({ gameId: game!.id, playerId: ans.playerId, questionId: q!.id, selectedOptionId: 'a' }),
            getHostState(game!.id),
            getHostState(game!.id),
          ]);
        } else {
          // 作答者連點兩次送出（一對一錯），只能算一次
          await Promise.all([
            recordBuzzAnswer({ gameId: game!.id, playerId: ans.playerId, questionId: q!.id, selectedOptionId: step === TEAMS - 1 ? 'b' : 'a' }),
            recordBuzzAnswer({ gameId: game!.id, playerId: ans.playerId, questionId: q!.id, selectedOptionId: 'b' }),
            ...players.slice(0, 10).map(pid => getPlayerState(game!.id, pid)),
          ]);
        }
        await invariants(game!.id, q!.id);
      }
    }
  }, 180_000);
});
