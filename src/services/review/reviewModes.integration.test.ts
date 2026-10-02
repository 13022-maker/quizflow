// 協作批閱四種新題型的整合測試：走真實 reviewStore + 真實 migration（本機無 DATABASE_URL 時
// src/libs/DB.ts 自動用 in-memory PGlite），驗證 DB 欄位、題型分派、防洩題、計分與共創出題的送出把關。
// 期望分數全部手算，算式寫在註解。
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/libs/DB';
import {
  reviewGameSchema,
  reviewPlayerSchema,
  reviewSampleSchema,
  reviewSetSchema,
  reviewTeamSchema,
} from '@/models/Schema';

import { serializeCreatedQuestion } from './createModes';
import type { ReviewCreateMode, ReviewMode } from './modes';
import {
  getHostState,
  getTeamState,
  submitFinalAnswer,
  upsertScore,
  upsertSubmission,
} from './reviewStore';

let pinSeq = 0;

async function seedGame(params: {
  reviewMode: ReviewMode;
  createMode?: ReviewCreateMode;
  samples: { content: string; refData: unknown }[];
  status: 'reviewing' | 'creating';
  teams: number; // 每組 2 人
}) {
  const [set] = await db.insert(reviewSetSchema).values({
    ownerId: 'user_test',
    title: `測試題組 ${params.reviewMode}`,
    topicPrompt: '延伸創作',
    reviewMode: params.reviewMode,
    createMode: params.createMode ?? 'free_text',
  }).returning();
  const samples = await db.insert(reviewSampleSchema).values(params.samples.map((s, i) => ({
    reviewSetId: set!.id,
    content: s.content,
    orderIndex: i,
    refCorrectness: 0,
    refCompleteness: 0,
    refClarity: 0,
    refCreativity: 0,
    refData: s.refData,
  }))).returning();
  pinSeq += 1;
  const [game] = await db.insert(reviewGameSchema).values({
    reviewSetId: set!.id,
    hostUserId: 'user_test',
    gamePin: `T${String(pinSeq).padStart(5, '0')}`,
    status: params.status,
  }).returning();

  const teams: { teamId: number; playerIds: number[] }[] = [];
  for (let t = 0; t < params.teams; t++) {
    const [team] = await db.insert(reviewTeamSchema).values({ gameId: game!.id, teamName: `第 ${t + 1} 組` }).returning();
    const players = await db.insert(reviewPlayerSchema).values([0, 1].map(p => ({
      gameId: game!.id,
      teamId: team!.id,
      nickname: `g${game!.id}t${t}p${p}`,
      playerToken: `tok-${game!.id}-${t}-${p}`,
    }))).returning();
    await db.update(reviewTeamSchema).set({ leaderId: players[0]!.id }).where(eq(reviewTeamSchema.id, team!.id));
    teams.push({ teamId: team!.id, playerIds: players.map(p => p.id) });
  }
  return { setId: set!.id, gameId: game!.id, sampleIds: samples.map(s => s.id), teams };
}

async function answer(gameId: number, playerId: number, sampleId: number, responseData: unknown) {
  const r = await upsertScore({ gameId, playerId, sampleId, responseData, comment: null });

  expect(r).toEqual({ ok: true });
}

async function resultsAccuracy(gameId: number) {
  await db.update(reviewGameSchema).set({ status: 'results' }).where(eq(reviewGameSchema.id, gameId));
  const host = await getHostState(gameId);
  return host!.resultsDetail![0]!.samples.map(s => s.accuracyScore);
}

describe('對錯判斷 judgment（整合）', () => {
  it('學生端只拿到錯因選項、計分與手算一致', async () => {
    const g = await seedGame({
      reviewMode: 'judgment',
      status: 'reviewing',
      teams: 1,
      samples: [
        { content: '250×40=10000 毫升＝100 公升', refData: { isCorrect: false, reasonOptions: ['計算錯誤', '單位換算錯', '漏看條件'], correctReasonIndex: 1 } },
        { content: '250×40=10000 毫升＝10 公升', refData: { isCorrect: true, reasonOptions: ['單位換算錯', '計算錯誤'], correctReasonIndex: null } },
      ],
    });
    const [p1, p2] = g.teams[0]!.playerIds as [number, number];

    const team = await getTeamState(g.gameId, p1);

    expect(team!.reviewMode).toBe('judgment');
    expect(team!.samples[0]!.clientData).toEqual({ reasonOptions: ['計算錯誤', '單位換算錯', '漏看條件'] });
    expect(JSON.stringify(team!.samples)).not.toContain('isCorrect');
    expect(JSON.stringify(team!.samples)).not.toContain('correctReasonIndex');

    // 格式不合（判錯卻沒選錯因）被 server 擋下
    const bad = await upsertScore({ gameId: g.gameId, playerId: p1, sampleId: g.sampleIds[0]!, responseData: { isCorrect: false, reasonIndex: null }, comment: null });

    expect(bad.ok).toBe(false);

    await answer(g.gameId, p1, g.sampleIds[0]!, { isCorrect: false, reasonIndex: 1 }); // 1
    await answer(g.gameId, p2, g.sampleIds[0]!, { isCorrect: false, reasonIndex: 0 }); // 0.5
    await answer(g.gameId, p1, g.sampleIds[1]!, { isCorrect: true, reasonIndex: null }); // 1
    await answer(g.gameId, p2, g.sampleIds[1]!, { isCorrect: false, reasonIndex: 0 }); // 0

    // 1000 分 / 2 則 = 每則 500：第 1 則 (1+0.5)/2×500=375；第 2 則 (1+0)/2×500=250
    expect(await resultsAccuracy(g.gameId)).toEqual([375, 250]);
  });
});

describe('挑錯標註 error_spot（整合）', () => {
  it('學生端只拿到切好的句子、F1 計分與手算一致', async () => {
    const g = await seedGame({
      reviewMode: 'error_spot',
      status: 'reviewing',
      teams: 1,
      samples: [
        { content: '我先算面積。長乘寬等於 20。所以周長是 20。', refData: { errorSegmentIndexes: [2] } },
        { content: '全部都對。沒有錯。', refData: { errorSegmentIndexes: [] } },
      ],
    });
    const [p1, p2] = g.teams[0]!.playerIds as [number, number];

    const team = await getTeamState(g.gameId, p1);

    expect(team!.samples[0]!.clientData).toEqual({ segments: ['我先算面積。', '長乘寬等於 20。', '所以周長是 20。'] });
    expect(JSON.stringify(team!.samples)).not.toContain('errorSegmentIndexes');

    await answer(g.gameId, p1, g.sampleIds[0]!, { selectedSegmentIndexes: [2] }); // F1=1
    await answer(g.gameId, p2, g.sampleIds[0]!, { selectedSegmentIndexes: [1, 2] }); // P=1/2 R=1 → F1=2/3
    await answer(g.gameId, p1, g.sampleIds[1]!, { selectedSegmentIndexes: [] }); // 兩邊皆空 → 1
    await answer(g.gameId, p2, g.sampleIds[1]!, { selectedSegmentIndexes: [0] }); // P=0 → 0

    // 第 1 則 (1+2/3)/2×500=416.67→417；第 2 則 (1+0)/2×500=250
    expect(await resultsAccuracy(g.gameId)).toEqual([417, 250]);
  });
});

describe('排序比較 ranking（整合）', () => {
  it('名次不外洩、名次差計分與手算一致', async () => {
    const g = await seedGame({
      reviewMode: 'ranking',
      status: 'reviewing',
      teams: 1,
      samples: [
        { content: '完整又有創意的答案', refData: { rank: 1 } },
        { content: '普通的答案', refData: { rank: 2 } },
      ],
    });
    const [p1, p2] = g.teams[0]!.playerIds as [number, number];

    const team = await getTeamState(g.gameId, p1);

    expect(team!.samples.map(s => s.clientData)).toEqual([null, null]);

    await answer(g.gameId, p1, g.sampleIds[0]!, { rank: 1 }); // 1−0/1=1
    await answer(g.gameId, p2, g.sampleIds[0]!, { rank: 2 }); // 1−1/1=0
    await answer(g.gameId, p1, g.sampleIds[1]!, { rank: 2 }); // 1
    await answer(g.gameId, p2, g.sampleIds[1]!, { rank: 2 }); // 1

    // 第 1 則 (1+0)/2×500=250；第 2 則 (1+1)/2×500=500
    expect(await resultsAccuracy(g.gameId)).toEqual([250, 500]);
  });

  it('拿別的題組的 sampleId 作答會被拒絕', async () => {
    const a = await seedGame({ reviewMode: 'ranking', status: 'reviewing', teams: 1, samples: [{ content: 'a', refData: { rank: 1 } }, { content: 'b', refData: { rank: 2 } }] });
    const b = await seedGame({ reviewMode: 'ranking', status: 'reviewing', teams: 1, samples: [{ content: 'c', refData: { rank: 1 } }, { content: 'd', refData: { rank: 2 } }] });

    const r = await upsertScore({ gameId: a.gameId, playerId: a.teams[0]!.playerIds[0]!, sampleId: b.sampleIds[0]!, responseData: { rank: 1 }, comment: null });

    expect(r).toEqual({ ok: false, error: 'SAMPLE_NOT_FOUND', status: 404 });
  });
});

describe('小組出一道題目 question（整合）', () => {
  it('未完成題目不能正式送出；完整題目可送出；投票只列完整題目', async () => {
    const g = await seedGame({
      reviewMode: 'ranking',
      createMode: 'question',
      status: 'creating',
      teams: 2,
      samples: [{ content: 'a', refData: { rank: 1 } }, { content: 'b', refData: { rank: 2 } }],
    });
    const leaderA = g.teams[0]!.playerIds[0]!;
    const leaderB = g.teams[1]!.playerIds[0]!;
    const valid = serializeCreatedQuestion({
      type: 'single_choice',
      body: '光合作用主要在植物的哪個構造進行？',
      options: [{ id: 'a', text: '葉綠體' }, { id: 'b', text: '粒線體' }],
      correctAnswers: ['a'],
    });

    // 半成品可以存，但正式送出要被擋
    expect(await upsertSubmission({ gameId: g.gameId, playerId: leaderA, content: '{"type":"single_choice","body":"未完成"' })).toEqual({ ok: true });

    const blocked = await submitFinalAnswer({ gameId: g.gameId, playerId: leaderA });

    expect(blocked.ok).toBe(false);

    expect(await upsertSubmission({ gameId: g.gameId, playerId: leaderA, content: valid })).toEqual({ ok: true });
    expect(await submitFinalAnswer({ gameId: g.gameId, playerId: leaderA })).toEqual({ ok: true });
    expect(await upsertSubmission({ gameId: g.gameId, playerId: leaderB, content: '{"type":"true_false"' })).toEqual({ ok: true });

    await db.update(reviewGameSchema).set({ status: 'voting' }).where(eq(reviewGameSchema.id, g.gameId));

    // B 組看得到 A 組完整題目；A 組看不到 B 組的半成品
    const viewB = await getTeamState(g.gameId, leaderB);
    const viewA = await getTeamState(g.gameId, leaderA);

    expect(viewB!.votingCandidates!.map(c => c.teamId)).toEqual([g.teams[0]!.teamId]);
    expect(viewA!.votingCandidates).toEqual([]);
  });
});
