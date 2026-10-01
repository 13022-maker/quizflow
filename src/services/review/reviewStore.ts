// src/services/review/reviewStore.ts
// 協作批閱統一資料存取層：把 DB query 集中在此，API Route / Server Action 呼叫即可。

import { and, asc, count, desc, eq, inArray, ne } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  reviewDraftSchema,
  reviewGameSchema,
  reviewLeaderVoteSchema,
  reviewPlayerSchema,
  reviewSampleSchema,
  reviewScoreSchema,
  reviewSetSchema,
  reviewSubmissionEditSchema,
  reviewSubmissionSchema,
  reviewTeamSchema,
  reviewVoteSchema,
} from '@/models/Schema';

import { publishTick } from './ablyServer';
import { summarizeContributors } from './contributors';
import { validateCreateContent } from './createModes';
import { pickLeader } from './leaderElection';
import type { ModeSample, ModeScoreRow, ReviewCreateMode, ReviewMode } from './modes';
import { calcModeSampleAccuracy, getModeHandler } from './modes';
import type { RubricScores } from './scoring';
import { distributeAccuracyPoints } from './scoring';
import { resolveFallbackContent } from './submissionFallback';
import type {
  ReviewGameStatus,
  ReviewHostState,
  ReviewSampleForClient,
  ReviewTeamResultDetail,
  ReviewTeamState,
} from './types';

export type ReviewSampleWithRef = {
  id: number;
  content: string;
  orderIndex: number;
  refCorrectness: number;
  refCompleteness: number;
  refClarity: number;
  refCreativity: number;
  isAiAnswer: boolean;
  refData: unknown;
};

// DB 列 → 題型 handler 用的格式（共用給 getResultsDetail 與 finishGame）
export function toModeSample(s: ReviewSampleWithRef): ModeSample {
  return {
    id: s.id,
    content: s.content,
    orderIndex: s.orderIndex,
    ref: {
      correctness: s.refCorrectness,
      completeness: s.refCompleteness,
      clarity: s.refClarity,
      creativity: s.refCreativity,
    },
    refData: s.refData,
  };
}

export function toModeScoreRow(s: {
  playerId: number;
  sampleId: number;
  correctness: number;
  completeness: number;
  clarity: number;
  creativity: number;
  responseData: unknown;
}): ModeScoreRow {
  return {
    playerId: s.playerId,
    sampleId: s.sampleId,
    rubric: {
      correctness: s.correctness,
      completeness: s.completeness,
      clarity: s.clarity,
      creativity: s.creativity,
    },
    responseData: s.responseData,
  };
}

export async function getReviewSetModes(
  reviewSetId: number,
): Promise<{ reviewMode: ReviewMode; createMode: ReviewCreateMode } | null> {
  const [row] = await db
    .select({ reviewMode: reviewSetSchema.reviewMode, createMode: reviewSetSchema.createMode })
    .from(reviewSetSchema)
    .where(eq(reviewSetSchema.id, reviewSetId))
    .limit(1);
  return row ?? null;
}

// 取得某題組的範例答案（含老師標準分，內部用；學生端回應前一定要 strip 成 ReviewSampleForClient）
export async function getReviewSamples(reviewSetId: number): Promise<ReviewSampleWithRef[]> {
  return db
    .select({
      id: reviewSampleSchema.id,
      content: reviewSampleSchema.content,
      orderIndex: reviewSampleSchema.orderIndex,
      refCorrectness: reviewSampleSchema.refCorrectness,
      refCompleteness: reviewSampleSchema.refCompleteness,
      refClarity: reviewSampleSchema.refClarity,
      refCreativity: reviewSampleSchema.refCreativity,
      isAiAnswer: reviewSampleSchema.isAiAnswer,
      refData: reviewSampleSchema.refData,
    })
    .from(reviewSampleSchema)
    .where(eq(reviewSampleSchema.reviewSetId, reviewSetId))
    .orderBy(asc(reviewSampleSchema.orderIndex));
}

export async function findGameByPin(
  pin: string,
): Promise<{ id: number; reviewSetId: number; status: ReviewGameStatus } | null> {
  const [row] = await db
    .select({
      id: reviewGameSchema.id,
      reviewSetId: reviewGameSchema.reviewSetId,
      status: reviewGameSchema.status,
    })
    .from(reviewGameSchema)
    .where(eq(reviewGameSchema.gamePin, pin))
    .limit(1);
  return row ?? null;
}

export async function isNicknameTaken(gameId: number, nickname: string): Promise<boolean> {
  const [row] = await db
    .select({ id: reviewPlayerSchema.id })
    .from(reviewPlayerSchema)
    .where(and(eq(reviewPlayerSchema.gameId, gameId), eq(reviewPlayerSchema.nickname, nickname)))
    .limit(1);
  return !!row;
}

export async function verifyPlayerToken(
  gameId: number,
  playerToken: string,
): Promise<{ playerId: number } | null> {
  const [row] = await db
    .select({ id: reviewPlayerSchema.id })
    .from(reviewPlayerSchema)
    .where(and(eq(reviewPlayerSchema.gameId, gameId), eq(reviewPlayerSchema.playerToken, playerToken)))
    .limit(1);
  return row ? { playerId: row.id } : null;
}

// 每組的進度統計：一次把 game 底下所有 team 相關列都撈出來在記憶體分組，
// 避免每組各下好幾條 query（N+1）
async function getTeamsWithProgress(
  gameId: number,
  sampleCount: number,
): Promise<ReviewHostState['teams']> {
  const teams = await db.select().from(reviewTeamSchema).where(eq(reviewTeamSchema.gameId, gameId));
  if (teams.length === 0) {
    return [];
  }
  const teamIds = teams.map(t => t.id);

  const players = await db
    .select({ id: reviewPlayerSchema.id, teamId: reviewPlayerSchema.teamId, nickname: reviewPlayerSchema.nickname })
    .from(reviewPlayerSchema)
    .where(inArray(reviewPlayerSchema.teamId, teamIds));
  const scores = await db
    .select({
      teamId: reviewScoreSchema.teamId,
      playerId: reviewScoreSchema.playerId,
      sampleId: reviewScoreSchema.sampleId,
    })
    .from(reviewScoreSchema)
    .where(inArray(reviewScoreSchema.teamId, teamIds));
  const submissions = await db
    .select({
      teamId: reviewSubmissionSchema.teamId,
      content: reviewSubmissionSchema.content,
      autoSubmitted: reviewSubmissionSchema.autoSubmitted,
      submittedAt: reviewSubmissionSchema.submittedAt,
    })
    .from(reviewSubmissionSchema)
    .where(inArray(reviewSubmissionSchema.teamId, teamIds));
  const votes = await db
    .select({ votedForTeamId: reviewVoteSchema.votedForTeamId })
    .from(reviewVoteSchema)
    .where(inArray(reviewVoteSchema.votedForTeamId, teamIds));
  const drafts = await db
    .select({ teamId: reviewDraftSchema.teamId, playerId: reviewDraftSchema.playerId, content: reviewDraftSchema.content })
    .from(reviewDraftSchema)
    .where(inArray(reviewDraftSchema.teamId, teamIds));

  return teams.map((team) => {
    const teamPlayers = players.filter(p => p.teamId === team.id);
    const teamScores = scores.filter(s => s.teamId === team.id);
    const scoredSampleIds = new Set(teamScores.map(s => s.sampleId));

    const doneSampleCountByPlayer = new Map<number, number>();
    for (const s of teamScores) {
      doneSampleCountByPlayer.set(s.playerId, (doneSampleCountByPlayer.get(s.playerId) ?? 0) + 1);
    }
    const memberReadyCount = sampleCount === 0
      ? 0
      : teamPlayers.filter(p => (doneSampleCountByPlayer.get(p.id) ?? 0) >= sampleCount).length;

    const submission = submissions.find(s => s.teamId === team.id);
    const votesReceived = votes.filter(v => v.votedForTeamId === team.id).length;
    const teamDrafts = drafts
      .filter(d => d.teamId === team.id)
      .map(d => ({ playerId: d.playerId, charCount: d.content.length }));

    return {
      id: team.id,
      teamName: team.teamName,
      memberCount: teamPlayers.length,
      members: teamPlayers.map(p => ({ id: p.id, nickname: p.nickname })),
      score: team.score,
      scoredSampleCount: scoredSampleIds.size,
      memberReadyCount,
      hasSubmission: !!submission && submission.content.trim().length > 0,
      submittedAt: submission?.submittedAt ? submission.submittedAt.toISOString() : null,
      leaderId: team.leaderId,
      autoSubmitted: submission?.autoSubmitted ?? false,
      contributors: summarizeContributors(teamDrafts, teamPlayers.map(p => ({ id: p.id, nickname: p.nickname }))),
      votesReceived,
    };
  });
}

// results 階段的每組明細：分數 vs 標準分逐則對照，供老師報表使用
async function getResultsDetail(
  gameId: number,
  samples: ReviewSampleWithRef[],
  reviewMode: ReviewMode,
): Promise<ReviewTeamResultDetail[]> {
  const teams = await db.select().from(reviewTeamSchema).where(eq(reviewTeamSchema.gameId, gameId));
  if (teams.length === 0) {
    return [];
  }
  const teamIds = teams.map(t => t.id);

  const players = await db
    .select({ id: reviewPlayerSchema.id, teamId: reviewPlayerSchema.teamId, nickname: reviewPlayerSchema.nickname })
    .from(reviewPlayerSchema)
    .where(inArray(reviewPlayerSchema.teamId, teamIds));
  const scores = await db.select().from(reviewScoreSchema).where(inArray(reviewScoreSchema.teamId, teamIds));
  const submissions = await db
    .select()
    .from(reviewSubmissionSchema)
    .where(inArray(reviewSubmissionSchema.teamId, teamIds));
  const voteRows = await db
    .select()
    .from(reviewVoteSchema)
    .where(inArray(reviewVoteSchema.votedForTeamId, teamIds));
  const drafts = await db
    .select({ teamId: reviewDraftSchema.teamId, playerId: reviewDraftSchema.playerId, content: reviewDraftSchema.content })
    .from(reviewDraftSchema)
    .where(inArray(reviewDraftSchema.teamId, teamIds));
  const accuracyPoints = distributeAccuracyPoints(samples.length);

  return teams.map((team) => {
    const teamScores = scores.filter(s => s.teamId === team.id);
    const handler = getModeHandler(reviewMode);
    const sampleDetails = samples.map((sample, i) => {
      const modeSample = toModeSample(sample);
      const sampleScores = teamScores.filter(s => s.sampleId === sample.id).map(toModeScoreRow);
      const summary = handler.summarize({ sample: modeSample, sampleScores });
      return {
        sampleId: sample.id,
        sampleContent: sample.content,
        teamSummary: summary.team,
        refSummary: summary.ref,
        responseCount: sampleScores.length,
        accuracyScore: calcModeSampleAccuracy(reviewMode, {
          sample: modeSample,
          sampleScores,
          sampleCount: samples.length,
          pointsForSample: accuracyPoints[i]!,
        }),
      };
    });
    const submission = submissions.find(s => s.teamId === team.id);
    const votesReceived = voteRows.filter(v => v.votedForTeamId === team.id).length;
    const teamPlayers = players.filter(p => p.teamId === team.id);
    const teamDrafts = drafts
      .filter(d => d.teamId === team.id)
      .map(d => ({ playerId: d.playerId, charCount: d.content.length }));

    return {
      teamId: team.id,
      members: teamPlayers.map(p => ({ id: p.id, nickname: p.nickname })),
      samples: sampleDetails,
      accuracyScore: team.accuracyScore,
      speedBonus: team.speedBonus,
      voteBonus: team.voteBonus,
      submission: submission?.content ?? null,
      leaderId: team.leaderId,
      autoSubmitted: submission?.autoSubmitted ?? false,
      contributors: summarizeContributors(teamDrafts, teamPlayers.map(p => ({ id: p.id, nickname: p.nickname }))),
      votesReceived,
    };
  });
}

export async function getHostState(gameId: number): Promise<ReviewHostState | null> {
  const [game] = await db.select().from(reviewGameSchema).where(eq(reviewGameSchema.id, gameId)).limit(1);
  if (!game) {
    return null;
  }
  const [reviewSet] = await db
    .select()
    .from(reviewSetSchema)
    .where(eq(reviewSetSchema.id, game.reviewSetId))
    .limit(1);
  if (!reviewSet) {
    return null;
  }

  const samples = await getReviewSamples(game.reviewSetId);
  const teams = await getTeamsWithProgress(gameId, samples.length);
  const createMode = reviewSet.createMode;

  const [joinedPlayerCountRow] = await db
    .select({ value: count() })
    .from(reviewPlayerSchema)
    .where(eq(reviewPlayerSchema.gameId, gameId));
  const joinedPlayerCount = joinedPlayerCountRow?.value ?? 0;

  // results 之後還會進 ended（老師按「結束活動」），報表資料不能因此消失
  const resultsDetail = (game.status === 'results' || game.status === 'ended')
    ? await getResultsDetail(gameId, samples, reviewSet.reviewMode)
    : null;

  return {
    game: {
      id: game.id,
      status: game.status,
      gamePin: game.gamePin,
      title: reviewSet.title,
      teamSize: reviewSet.teamSize,
      reviewMode: reviewSet.reviewMode,
      createMode,
      phaseStartedAt: game.phaseStartedAt ? game.phaseStartedAt.toISOString() : null,
      phaseDurationSec: game.phaseDurationSec,
    },
    teams,
    totalSamples: samples.length,
    joinedPlayerCount,
    resultsDetail,
  };
}

export async function getTeamState(gameId: number, playerId: number): Promise<ReviewTeamState | null> {
  const [game] = await db.select().from(reviewGameSchema).where(eq(reviewGameSchema.id, gameId)).limit(1);
  if (!game) {
    return null;
  }
  const [me] = await db
    .select()
    .from(reviewPlayerSchema)
    .where(and(eq(reviewPlayerSchema.id, playerId), eq(reviewPlayerSchema.gameId, gameId)))
    .limit(1);
  if (!me) {
    return null;
  }

  const [reviewSet] = await db
    .select({
      topicPrompt: reviewSetSchema.topicPrompt,
      reviewMode: reviewSetSchema.reviewMode,
      createMode: reviewSetSchema.createMode,
    })
    .from(reviewSetSchema)
    .where(eq(reviewSetSchema.id, game.reviewSetId))
    .limit(1);
  if (!reviewSet) {
    return null;
  }

  const samplesRaw = await getReviewSamples(game.reviewSetId);
  const modeHandler = getModeHandler(reviewSet.reviewMode);
  // 標準答案（ref 欄位 / refData）一律不送到學生端，只送 handler 篩過的公開資料
  const samples: ReviewSampleForClient[] = samplesRaw.map(s => ({
    id: s.id,
    content: s.content,
    orderIndex: s.orderIndex,
    isAiAnswer: s.isAiAnswer,
    clientData: modeHandler.toClientData({ content: s.content, refData: s.refData }),
  }));

  let teammates: { id: number; nickname: string }[] = [];
  const myScores: ReviewTeamState['myScores'] = {};
  const teammateScores: ReviewTeamState['teammateScores'] = {};
  let leaderId: number | null = null;
  let myDraft = '';
  let teammateDrafts: ReviewTeamState['teammateDrafts'] = [];
  let myLeaderVote: number | null = null;
  let submission: ReviewTeamState['submission'] = null;
  let hasVoted = false;
  let votingCandidates: ReviewTeamState['votingCandidates'] = null;
  let finalTeamRank: ReviewTeamState['finalTeamRank'] = null;
  let teamName: string | null = null;

  if (me.teamId) {
    const [team] = await db
      .select({ teamName: reviewTeamSchema.teamName, leaderId: reviewTeamSchema.leaderId })
      .from(reviewTeamSchema)
      .where(eq(reviewTeamSchema.id, me.teamId))
      .limit(1);
    teamName = team?.teamName ?? null;
    leaderId = team?.leaderId ?? null;

    const teamMembers = await db
      .select({ id: reviewPlayerSchema.id, nickname: reviewPlayerSchema.nickname })
      .from(reviewPlayerSchema)
      .where(eq(reviewPlayerSchema.teamId, me.teamId))
      // 固定排序，避免每次輪詢回傳的組員順序不同，造成學生端按鈕位置亂跳
      .orderBy(asc(reviewPlayerSchema.joinedAt), asc(reviewPlayerSchema.id));
    teammates = teamMembers.filter(p => p.id !== me.id);

    const teamDrafts = await db
      .select({ playerId: reviewDraftSchema.playerId, content: reviewDraftSchema.content, updatedAt: reviewDraftSchema.updatedAt })
      .from(reviewDraftSchema)
      .where(eq(reviewDraftSchema.teamId, me.teamId));
    myDraft = teamDrafts.find(d => d.playerId === me.id)?.content ?? '';
    teammateDrafts = teamDrafts
      .filter(d => d.playerId !== me.id)
      .map(d => ({
        playerId: d.playerId,
        nickname: teamMembers.find(m => m.id === d.playerId)?.nickname ?? '組員',
        content: d.content,
        updatedAt: d.updatedAt.toISOString(),
      }));

    const [myVoteRow] = await db
      .select({ votedForPlayerId: reviewLeaderVoteSchema.votedForPlayerId })
      .from(reviewLeaderVoteSchema)
      .where(and(eq(reviewLeaderVoteSchema.teamId, me.teamId), eq(reviewLeaderVoteSchema.voterPlayerId, me.id)))
      .limit(1);
    myLeaderVote = myVoteRow?.votedForPlayerId ?? null;

    const teamScores = await db
      .select()
      .from(reviewScoreSchema)
      .where(eq(reviewScoreSchema.teamId, me.teamId));
    for (const s of teamScores) {
      const entry = {
        correctness: s.correctness,
        completeness: s.completeness,
        clarity: s.clarity,
        creativity: s.creativity,
        responseData: s.responseData as unknown,
        comment: s.comment,
      };
      if (s.playerId === me.id) {
        myScores[s.sampleId] = entry;
      } else {
        const nickname = teamMembers.find(m => m.id === s.playerId)?.nickname ?? '組員';
        teammateScores[s.sampleId] = [
          ...(teammateScores[s.sampleId] ?? []),
          { ...entry, playerId: s.playerId, nickname },
        ];
      }
    }

    const [sub] = await db
      .select()
      .from(reviewSubmissionSchema)
      .where(eq(reviewSubmissionSchema.teamId, me.teamId))
      .limit(1);
    if (sub) {
      submission = {
        content: sub.content,
        updatedAt: sub.updatedAt.toISOString(),
        submittedAt: sub.submittedAt ? sub.submittedAt.toISOString() : null,
        autoSubmitted: sub.autoSubmitted,
      };
    }

    const [myVote] = await db
      .select()
      .from(reviewVoteSchema)
      .where(and(eq(reviewVoteSchema.gameId, gameId), eq(reviewVoteSchema.voterTeamId, me.teamId)))
      .limit(1);
    hasVoted = !!myVote;

    if (game.status === 'voting') {
      const otherSubmissions = await db
        .select({ teamId: reviewSubmissionSchema.teamId, content: reviewSubmissionSchema.content })
        .from(reviewSubmissionSchema)
        .innerJoin(reviewTeamSchema, eq(reviewTeamSchema.id, reviewSubmissionSchema.teamId))
        .where(and(
          eq(reviewTeamSchema.gameId, gameId),
          ne(reviewSubmissionSchema.teamId, me.teamId),
        ));
      votingCandidates = otherSubmissions
        .filter(s => s.content.trim().length > 0)
        .map(s => ({ teamId: s.teamId, content: s.content }));
    }

    // 同上：ended 是 results 之後的終態，排名顯示不能因此消失
    if (game.status === 'results' || game.status === 'ended') {
      const allTeams = await db
        .select({ id: reviewTeamSchema.id, score: reviewTeamSchema.score })
        .from(reviewTeamSchema)
        .where(eq(reviewTeamSchema.gameId, gameId))
        .orderBy(desc(reviewTeamSchema.score));
      const idx = allTeams.findIndex(t => t.id === me.teamId);
      if (idx >= 0) {
        finalTeamRank = { rank: idx + 1, score: allTeams[idx]!.score };
      }
    }
  }

  return {
    game: {
      id: game.id,
      status: game.status,
      phaseStartedAt: game.phaseStartedAt ? game.phaseStartedAt.toISOString() : null,
      phaseDurationSec: game.phaseDurationSec,
    },
    topicPrompt: reviewSet.topicPrompt,
    reviewMode: reviewSet.reviewMode,
    createMode: reviewSet.createMode,
    me: { id: me.id, nickname: me.nickname, teamId: me.teamId, teamName },
    teammates,
    samples,
    myScores,
    teammateScores,
    leaderId,
    myDraft,
    teammateDrafts,
    myLeaderVote,
    submission,
    hasVoted,
    votingCandidates,
    finalTeamRank,
  };
}

export async function upsertScore(params: {
  gameId: number;
  playerId: number;
  sampleId: number;
  // rubric 題型傳 scores；其他題型傳 responseData（由題型 handler 的 responseSchema 驗證）
  scores?: RubricScores;
  responseData?: unknown;
  comment: string | null;
}): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const { gameId, playerId, sampleId, comment } = params;

  const [player] = await db
    .select()
    .from(reviewPlayerSchema)
    .where(and(eq(reviewPlayerSchema.id, playerId), eq(reviewPlayerSchema.gameId, gameId)))
    .limit(1);
  if (!player || !player.teamId) {
    return { ok: false, error: 'NOT_ON_TEAM', status: 403 };
  }

  const [game] = await db
    .select({ status: reviewGameSchema.status, reviewSetId: reviewGameSchema.reviewSetId })
    .from(reviewGameSchema)
    .where(eq(reviewGameSchema.id, gameId))
    .limit(1);
  if (!game || game.status !== 'reviewing') {
    return { ok: false, error: 'NOT_REVIEWING_PHASE', status: 409 };
  }

  // sample 必須屬於這場遊戲的題組，避免學生拿別場的 sampleId 亂寫
  const [sample] = await db
    .select({ id: reviewSampleSchema.id })
    .from(reviewSampleSchema)
    .where(and(eq(reviewSampleSchema.id, sampleId), eq(reviewSampleSchema.reviewSetId, game.reviewSetId)))
    .limit(1);
  if (!sample) {
    return { ok: false, error: 'SAMPLE_NOT_FOUND', status: 404 };
  }

  const modes = await getReviewSetModes(game.reviewSetId);
  if (!modes) {
    return { ok: false, error: 'SET_NOT_FOUND', status: 404 };
  }
  const handler = getModeHandler(modes.reviewMode);
  let scores: RubricScores = { correctness: 0, completeness: 0, clarity: 0, creativity: 0 };
  let responseData: unknown = null;
  if (handler.responseSchema === null) {
    if (!params.scores) {
      return { ok: false, error: 'MISSING_SCORES', status: 400 };
    }
    scores = params.scores;
  } else {
    const parsed = handler.responseSchema.safeParse(params.responseData);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.errors[0]?.message ?? 'INVALID_RESPONSE', status: 400 };
    }
    responseData = parsed.data;
  }

  await db
    .insert(reviewScoreSchema)
    .values({
      teamId: player.teamId,
      playerId,
      sampleId,
      correctness: scores.correctness,
      completeness: scores.completeness,
      clarity: scores.clarity,
      creativity: scores.creativity,
      responseData,
      comment,
      submittedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [reviewScoreSchema.playerId, reviewScoreSchema.sampleId],
      set: {
        correctness: scores.correctness,
        completeness: scores.completeness,
        clarity: scores.clarity,
        creativity: scores.creativity,
        responseData,
        comment,
        submittedAt: new Date(),
      },
    });

  await publishTick(gameId);
  return { ok: true };
}

export async function upsertSubmission(params: {
  gameId: number;
  playerId: number;
  content: string;
}): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const { gameId, playerId, content } = params;

  const [player] = await db
    .select()
    .from(reviewPlayerSchema)
    .where(and(eq(reviewPlayerSchema.id, playerId), eq(reviewPlayerSchema.gameId, gameId)))
    .limit(1);
  if (!player || !player.teamId) {
    return { ok: false, error: 'NOT_ON_TEAM', status: 403 };
  }

  const [team] = await db
    .select({ leaderId: reviewTeamSchema.leaderId })
    .from(reviewTeamSchema)
    .where(eq(reviewTeamSchema.id, player.teamId))
    .limit(1);
  if (!team) {
    return { ok: false, error: 'NOT_TEAM_LEADER', status: 403 };
  }
  // 功能上線前就存在的場次 leader_id 會是 NULL，這裡即時補推選一位，避免整組都存不了檔
  const effectiveLeaderId = await ensureTeamLeader(player.teamId, team.leaderId);
  if (effectiveLeaderId !== playerId) {
    return { ok: false, error: 'NOT_TEAM_LEADER', status: 403 };
  }

  const [game] = await db
    .select({ status: reviewGameSchema.status })
    .from(reviewGameSchema)
    .where(eq(reviewGameSchema.id, gameId))
    .limit(1);
  if (!game || game.status !== 'creating') {
    return { ok: false, error: 'NOT_CREATING_PHASE', status: 409 };
  }

  const [existing] = await db
    .select({ submittedAt: reviewSubmissionSchema.submittedAt })
    .from(reviewSubmissionSchema)
    .where(eq(reviewSubmissionSchema.teamId, player.teamId))
    .limit(1);
  if (existing?.submittedAt) {
    return { ok: false, error: 'ALREADY_SUBMITTED', status: 409 };
  }

  await db
    .insert(reviewSubmissionSchema)
    .values({ teamId: player.teamId, content, lastEditedByPlayerId: playerId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: reviewSubmissionSchema.teamId,
      set: { content, lastEditedByPlayerId: playerId, updatedAt: new Date() },
    });
  // 只記錄「誰存過檔」，供老師事後看貢獻度，不記內容差異
  await db.insert(reviewSubmissionEditSchema).values({ teamId: player.teamId, playerId });

  await publishTick(gameId);
  return { ok: true };
}

export async function upsertDraft(params: {
  gameId: number;
  playerId: number;
  content: string;
}): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const { gameId, playerId, content } = params;

  const [player] = await db
    .select()
    .from(reviewPlayerSchema)
    .where(and(eq(reviewPlayerSchema.id, playerId), eq(reviewPlayerSchema.gameId, gameId)))
    .limit(1);
  if (!player || !player.teamId) {
    return { ok: false, error: 'NOT_ON_TEAM', status: 403 };
  }

  const [game] = await db
    .select({ status: reviewGameSchema.status })
    .from(reviewGameSchema)
    .where(eq(reviewGameSchema.id, gameId))
    .limit(1);
  if (!game || game.status !== 'creating') {
    return { ok: false, error: 'NOT_CREATING_PHASE', status: 409 };
  }

  await db
    .insert(reviewDraftSchema)
    .values({ teamId: player.teamId, playerId, content, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [reviewDraftSchema.teamId, reviewDraftSchema.playerId],
      set: { content, updatedAt: new Date() },
    });

  await publishTick(gameId);
  return { ok: true };
}

export async function upsertLeaderVote(params: {
  gameId: number;
  voterPlayerId: number;
  votedForPlayerId: number;
}): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const { gameId, voterPlayerId, votedForPlayerId } = params;

  const [voter] = await db
    .select()
    .from(reviewPlayerSchema)
    .where(and(eq(reviewPlayerSchema.id, voterPlayerId), eq(reviewPlayerSchema.gameId, gameId)))
    .limit(1);
  if (!voter || !voter.teamId) {
    return { ok: false, error: 'NOT_ON_TEAM', status: 403 };
  }

  const [game] = await db
    .select({ status: reviewGameSchema.status })
    .from(reviewGameSchema)
    .where(eq(reviewGameSchema.id, gameId))
    .limit(1);
  if (!game || game.status !== 'creating') {
    return { ok: false, error: 'NOT_CREATING_PHASE', status: 409 };
  }

  const teamMembers = await db
    .select({ id: reviewPlayerSchema.id, joinedAt: reviewPlayerSchema.joinedAt })
    .from(reviewPlayerSchema)
    .where(eq(reviewPlayerSchema.teamId, voter.teamId))
    // 固定排序，讓 pickLeader 的平票 tie-break 結果穩定（不隨 DB 回傳順序跳動）
    .orderBy(asc(reviewPlayerSchema.joinedAt), asc(reviewPlayerSchema.id));
  const target = teamMembers.find(m => m.id === votedForPlayerId);
  if (!target) {
    return { ok: false, error: 'TARGET_NOT_ON_TEAM', status: 400 };
  }

  await db
    .insert(reviewLeaderVoteSchema)
    .values({ teamId: voter.teamId, voterPlayerId, votedForPlayerId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [reviewLeaderVoteSchema.teamId, reviewLeaderVoteSchema.voterPlayerId],
      set: { votedForPlayerId, updatedAt: new Date() },
    });

  const votes = await db
    .select({
      voterPlayerId: reviewLeaderVoteSchema.voterPlayerId,
      votedForPlayerId: reviewLeaderVoteSchema.votedForPlayerId,
    })
    .from(reviewLeaderVoteSchema)
    .where(eq(reviewLeaderVoteSchema.teamId, voter.teamId));
  const newLeaderId = pickLeader(votes, teamMembers);
  if (newLeaderId !== null) {
    await db.update(reviewTeamSchema).set({ leaderId: newLeaderId }).where(eq(reviewTeamSchema.id, voter.teamId));
  }

  await publishTick(gameId);
  return { ok: true };
}

// 確保這組一定有隊長：已經有的話直接回傳；沒有的話（例如功能上線前就存在的場次）
// 依現有投票（可能是空陣列）即時推選一位並寫回 DB，跟 upsertLeaderVote 的邏輯一致
async function ensureTeamLeader(teamId: number, currentLeaderId: number | null): Promise<number | null> {
  if (currentLeaderId !== null) {
    return currentLeaderId;
  }
  const teamMembers = await db
    .select({ id: reviewPlayerSchema.id, joinedAt: reviewPlayerSchema.joinedAt })
    .from(reviewPlayerSchema)
    .where(eq(reviewPlayerSchema.teamId, teamId))
    .orderBy(asc(reviewPlayerSchema.joinedAt), asc(reviewPlayerSchema.id));
  if (teamMembers.length === 0) {
    return null;
  }
  const votes = await db
    .select({
      voterPlayerId: reviewLeaderVoteSchema.voterPlayerId,
      votedForPlayerId: reviewLeaderVoteSchema.votedForPlayerId,
    })
    .from(reviewLeaderVoteSchema)
    .where(eq(reviewLeaderVoteSchema.teamId, teamId));
  const leaderId = pickLeader(votes, teamMembers);
  if (leaderId !== null) {
    await db.update(reviewTeamSchema).set({ leaderId }).where(eq(reviewTeamSchema.id, teamId));
  }
  return leaderId;
}

export async function submitFinalAnswer(params: {
  gameId: number;
  playerId: number;
}): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const { gameId, playerId } = params;

  const [player] = await db
    .select()
    .from(reviewPlayerSchema)
    .where(and(eq(reviewPlayerSchema.id, playerId), eq(reviewPlayerSchema.gameId, gameId)))
    .limit(1);
  if (!player || !player.teamId) {
    return { ok: false, error: 'NOT_ON_TEAM', status: 403 };
  }

  const [team] = await db
    .select({ leaderId: reviewTeamSchema.leaderId })
    .from(reviewTeamSchema)
    .where(eq(reviewTeamSchema.id, player.teamId))
    .limit(1);
  if (!team) {
    return { ok: false, error: 'NOT_TEAM_LEADER', status: 403 };
  }
  // 同 upsertSubmission：舊場次沒有隊長時即時補推選，否則整組都送不出去
  const effectiveLeaderId = await ensureTeamLeader(player.teamId, team.leaderId);
  if (effectiveLeaderId !== playerId) {
    return { ok: false, error: 'NOT_TEAM_LEADER', status: 403 };
  }

  const [game] = await db
    .select({ status: reviewGameSchema.status })
    .from(reviewGameSchema)
    .where(eq(reviewGameSchema.id, gameId))
    .limit(1);
  if (!game || game.status !== 'creating') {
    return { ok: false, error: 'NOT_CREATING_PHASE', status: 409 };
  }

  const [existing] = await db
    .select()
    .from(reviewSubmissionSchema)
    .where(eq(reviewSubmissionSchema.teamId, player.teamId))
    .limit(1);
  if (existing?.submittedAt) {
    return { ok: false, error: 'ALREADY_SUBMITTED', status: 409 };
  }

  // 依共創型態檢查內容格式（例如 question 型態必須是合法題目），不合格不給鎖定
  const [gameSet] = await db
    .select({ reviewSetId: reviewGameSchema.reviewSetId })
    .from(reviewGameSchema)
    .where(eq(reviewGameSchema.id, gameId))
    .limit(1);
  const modes = gameSet ? await getReviewSetModes(gameSet.reviewSetId) : null;
  const contentError = validateCreateContent(modes?.createMode ?? 'free_text', existing?.content ?? '');
  if (contentError) {
    return { ok: false, error: contentError, status: 400 };
  }

  await db
    .insert(reviewSubmissionSchema)
    .values({
      teamId: player.teamId,
      content: existing?.content ?? '',
      lastEditedByPlayerId: playerId,
      submittedAt: new Date(),
      autoSubmitted: false,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: reviewSubmissionSchema.teamId,
      set: { submittedAt: new Date(), autoSubmitted: false, updatedAt: new Date() },
    });

  await publishTick(gameId);
  return { ok: true };
}

// 老師把階段從 creating 推進到 voting 前呼叫：對每一組檢查是否已明確送出，
// 沒有的話依 resolveFallbackContent 規則自動補送出（見
// docs/superpowers/specs/2026-09-30-team-leader-submission-design.md）
export async function autoSubmitPendingTeams(gameId: number): Promise<void> {
  const teams = await db
    .select({ id: reviewTeamSchema.id, leaderId: reviewTeamSchema.leaderId })
    .from(reviewTeamSchema)
    .where(eq(reviewTeamSchema.gameId, gameId));
  if (teams.length === 0) {
    return;
  }
  const teamIds = teams.map(t => t.id);

  const submissions = await db
    .select()
    .from(reviewSubmissionSchema)
    .where(inArray(reviewSubmissionSchema.teamId, teamIds));
  const drafts = await db
    .select()
    .from(reviewDraftSchema)
    .where(inArray(reviewDraftSchema.teamId, teamIds));

  for (const team of teams) {
    const submission = submissions.find(s => s.teamId === team.id);
    if (submission?.submittedAt) {
      continue;
    }
    // 舊場次可能沒有隊長，這裡即時補推選一位，才有草稿可以當 fallback 內容
    const effectiveLeaderId = await ensureTeamLeader(team.id, team.leaderId);
    const leaderDraft = effectiveLeaderId
      ? drafts.find(d => d.teamId === team.id && d.playerId === effectiveLeaderId)
      : undefined;
    const content = resolveFallbackContent({
      existingSubmissionContent: submission?.content ?? null,
      leaderDraftContent: leaderDraft?.content ?? null,
    });

    await db
      .insert(reviewSubmissionSchema)
      .values({
        teamId: team.id,
        content,
        lastEditedByPlayerId: effectiveLeaderId,
        submittedAt: new Date(),
        autoSubmitted: true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: reviewSubmissionSchema.teamId,
        set: { content, submittedAt: new Date(), autoSubmitted: true, updatedAt: new Date() },
      });
  }
}

// 題組列表頁用：某老師底下某題組開過的所有場次，事後回顧用（讓老師不用記 gameId）
export async function getGameHistory(
  reviewSetId: number,
  hostUserId: string,
): Promise<{ id: number; status: ReviewGameStatus; gamePin: string; createdAt: string }[]> {
  const rows = await db
    .select({
      id: reviewGameSchema.id,
      status: reviewGameSchema.status,
      gamePin: reviewGameSchema.gamePin,
      createdAt: reviewGameSchema.createdAt,
    })
    .from(reviewGameSchema)
    .where(and(eq(reviewGameSchema.reviewSetId, reviewSetId), eq(reviewGameSchema.hostUserId, hostUserId)))
    .orderBy(desc(reviewGameSchema.createdAt));
  return rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function castVote(params: {
  gameId: number;
  playerId: number;
  votedForTeamId: number;
}): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const { gameId, playerId, votedForTeamId } = params;

  const [player] = await db
    .select()
    .from(reviewPlayerSchema)
    .where(and(eq(reviewPlayerSchema.id, playerId), eq(reviewPlayerSchema.gameId, gameId)))
    .limit(1);
  if (!player || !player.teamId) {
    return { ok: false, error: 'NOT_ON_TEAM', status: 403 };
  }
  if (player.teamId === votedForTeamId) {
    return { ok: false, error: 'CANNOT_VOTE_OWN_TEAM', status: 400 };
  }

  const [game] = await db
    .select({ status: reviewGameSchema.status })
    .from(reviewGameSchema)
    .where(eq(reviewGameSchema.id, gameId))
    .limit(1);
  if (!game || game.status !== 'voting') {
    return { ok: false, error: 'NOT_VOTING_PHASE', status: 409 };
  }

  const [targetTeam] = await db
    .select({ id: reviewTeamSchema.id })
    .from(reviewTeamSchema)
    .where(and(eq(reviewTeamSchema.id, votedForTeamId), eq(reviewTeamSchema.gameId, gameId)))
    .limit(1);
  if (!targetTeam) {
    return { ok: false, error: 'TEAM_NOT_FOUND', status: 404 };
  }

  try {
    await db.insert(reviewVoteSchema).values({ gameId, voterTeamId: player.teamId, votedForTeamId });
  } catch {
    // 極少見的 race condition（unique index）：查既有回傳，確認真的是重複投票
    // 而不是其他原因造成的 insert 失敗（比照 liveStore.ts 的 recordAnswer 寫法）
    const [again] = await db
      .select({ id: reviewVoteSchema.id })
      .from(reviewVoteSchema)
      .where(and(eq(reviewVoteSchema.gameId, gameId), eq(reviewVoteSchema.voterTeamId, player.teamId)))
      .limit(1);
    if (again) {
      return { ok: false, error: 'ALREADY_VOTED', status: 409 };
    }
    return { ok: false, error: 'VOTE_FAILED', status: 500 };
  }

  await publishTick(gameId);
  return { ok: true };
}
