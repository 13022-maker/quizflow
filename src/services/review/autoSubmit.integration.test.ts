// 系統逾時代送的整合測試：走真實 reviewStore + in-memory PGlite，
// 重現協作批閱 #17 第 1 組情境——隊長開過最終答案欄位但留白，組員草稿上千字，
// 舊規則會代送空字串，新規則要改用字數最多的組員草稿。
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/libs/DB';
import {
  reviewGameSchema,
  reviewPlayerSchema,
  reviewSetSchema,
  reviewSubmissionSchema,
  reviewTeamSchema,
} from '@/models/Schema';

import { autoSubmitPendingTeams, upsertDraft, upsertSubmission } from './reviewStore';

let pinSeq = 0;

async function seedCreatingGame(memberCount: number) {
  const [set] = await db.insert(reviewSetSchema).values({
    ownerId: 'user_test',
    title: '代送測試題組',
    topicPrompt: '延伸創作',
  }).returning();
  pinSeq += 1;
  const [game] = await db.insert(reviewGameSchema).values({
    reviewSetId: set!.id,
    hostUserId: 'user_test',
    gamePin: `A${String(pinSeq).padStart(5, '0')}`,
    status: 'creating',
  }).returning();
  const [team] = await db.insert(reviewTeamSchema).values({ gameId: game!.id, teamName: '第 1 組' }).returning();
  const players = await db.insert(reviewPlayerSchema).values(
    Array.from({ length: memberCount }, (_, p) => ({
      gameId: game!.id,
      teamId: team!.id,
      nickname: `a${game!.id}p${p}`,
      playerToken: `atok-${game!.id}-${p}`,
    })),
  ).returning();
  await db.update(reviewTeamSchema).set({ leaderId: players[0]!.id }).where(eq(reviewTeamSchema.id, team!.id));
  return { gameId: game!.id, teamId: team!.id, playerIds: players.map(p => p.id) };
}

async function submissionOf(teamId: number) {
  const [row] = await db.select().from(reviewSubmissionSchema).where(eq(reviewSubmissionSchema.teamId, teamId));
  return row;
}

describe('autoSubmitPendingTeams（整合）', () => {
  it('最終答案留白、隊長草稿空白時，代送字數最多的組員草稿', async () => {
    const { gameId, teamId, playerIds } = await seedCreatingGame(3);
    const [leader, memberA, memberB] = playerIds as [number, number, number];

    expect(await upsertSubmission({ gameId, playerId: leader, content: '' })).toEqual({ ok: true });
    expect(await upsertDraft({ gameId, playerId: memberA, content: '短草稿' })).toEqual({ ok: true });
    expect(await upsertDraft({ gameId, playerId: memberB, content: 'j 是 unsigned short，-1 轉換後變成 65535' })).toEqual({ ok: true });

    await autoSubmitPendingTeams(gameId);
    const row = await submissionOf(teamId);

    expect(row?.content).toBe('j 是 unsigned short，-1 轉換後變成 65535');
    expect(row?.autoSubmitted).toBe(true);
    expect(row?.submittedAt).not.toBeNull();
  });

  it('隊長最終答案有內容時照原樣代送，不被組員草稿覆蓋', async () => {
    const { gameId, teamId, playerIds } = await seedCreatingGame(2);
    const [leader, member] = playerIds as [number, number];

    expect(await upsertSubmission({ gameId, playerId: leader, content: '隊長整理的答案' })).toEqual({ ok: true });
    expect(await upsertDraft({ gameId, playerId: member, content: '組員比較長比較長比較長的草稿' })).toEqual({ ok: true });

    await autoSubmitPendingTeams(gameId);

    expect((await submissionOf(teamId))?.content).toBe('隊長整理的答案');
  });
});
