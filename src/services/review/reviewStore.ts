// src/services/review/reviewStore.ts
// 協作批閱統一資料存取層：把 DB query 集中在此，API Route / Server Action 呼叫即可。

import { and, asc, count, desc, eq, inArray, ne } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  reviewGameSchema,
  reviewPlayerSchema,
  reviewSampleSchema,
  reviewScoreSchema,
  reviewSetSchema,
  reviewSubmissionSchema,
  reviewTeamSchema,
  reviewVoteSchema,
} from '@/models/Schema';

import { publishTick } from './ablyServer';
import type { RubricScores } from './scoring';
import { calcAccuracyScore, distributeAccuracyPoints } from './scoring';
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
};

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
    .select({ id: reviewPlayerSchema.id, teamId: reviewPlayerSchema.teamId })
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
    .select({ teamId: reviewSubmissionSchema.teamId, content: reviewSubmissionSchema.content })
    .from(reviewSubmissionSchema)
    .where(inArray(reviewSubmissionSchema.teamId, teamIds));
  const votes = await db
    .select({ votedForTeamId: reviewVoteSchema.votedForTeamId })
    .from(reviewVoteSchema)
    .where(inArray(reviewVoteSchema.votedForTeamId, teamIds));

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

    return {
      id: team.id,
      teamName: team.teamName,
      memberCount: teamPlayers.length,
      score: team.score,
      scoredSampleCount: scoredSampleIds.size,
      memberReadyCount,
      hasSubmission: !!submission && submission.content.trim().length > 0,
      votesReceived,
    };
  });
}

// results 階段的每組明細：分數 vs 標準分逐則對照，供老師報表使用
async function getResultsDetail(
  gameId: number,
  samples: ReviewSampleWithRef[],
): Promise<ReviewTeamResultDetail[]> {
  const teams = await db.select().from(reviewTeamSchema).where(eq(reviewTeamSchema.gameId, gameId));
  if (teams.length === 0) {
    return [];
  }
  const teamIds = teams.map(t => t.id);

  const scores = await db.select().from(reviewScoreSchema).where(inArray(reviewScoreSchema.teamId, teamIds));
  const submissions = await db
    .select()
    .from(reviewSubmissionSchema)
    .where(inArray(reviewSubmissionSchema.teamId, teamIds));
  const voteRows = await db
    .select()
    .from(reviewVoteSchema)
    .where(inArray(reviewVoteSchema.votedForTeamId, teamIds));
  const accuracyPoints = distributeAccuracyPoints(samples.length);

  return teams.map((team) => {
    const teamScores = scores.filter(s => s.teamId === team.id);
    const sampleDetails = samples.map((sample, i) => {
      const sampleScores = teamScores.filter(s => s.sampleId === sample.id);
      const avg: RubricScores = sampleScores.length === 0
        ? { correctness: 0, completeness: 0, clarity: 0, creativity: 0 }
        : {
            correctness: sampleScores.reduce((a, s) => a + s.correctness, 0) / sampleScores.length,
            completeness: sampleScores.reduce((a, s) => a + s.completeness, 0) / sampleScores.length,
            clarity: sampleScores.reduce((a, s) => a + s.clarity, 0) / sampleScores.length,
            creativity: sampleScores.reduce((a, s) => a + s.creativity, 0) / sampleScores.length,
          };
      const ref: RubricScores = {
        correctness: sample.refCorrectness,
        completeness: sample.refCompleteness,
        clarity: sample.refClarity,
        creativity: sample.refCreativity,
      };
      return {
        sampleId: sample.id,
        sampleContent: sample.content,
        teamAvg: avg,
        ref,
        accuracyScore: calcAccuracyScore(avg, ref, accuracyPoints[i]!),
      };
    });
    const submission = submissions.find(s => s.teamId === team.id);
    const votesReceived = voteRows.filter(v => v.votedForTeamId === team.id).length;

    return {
      teamId: team.id,
      samples: sampleDetails,
      accuracyScore: team.accuracyScore,
      speedBonus: team.speedBonus,
      voteBonus: team.voteBonus,
      submission: submission?.content ?? null,
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

  const [joinedPlayerCountRow] = await db
    .select({ value: count() })
    .from(reviewPlayerSchema)
    .where(eq(reviewPlayerSchema.gameId, gameId));
  const joinedPlayerCount = joinedPlayerCountRow?.value ?? 0;

  const resultsDetail = game.status === 'results' ? await getResultsDetail(gameId, samples) : null;

  return {
    game: {
      id: game.id,
      status: game.status,
      gamePin: game.gamePin,
      title: reviewSet.title,
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
    .select({ topicPrompt: reviewSetSchema.topicPrompt })
    .from(reviewSetSchema)
    .where(eq(reviewSetSchema.id, game.reviewSetId))
    .limit(1);
  if (!reviewSet) {
    return null;
  }

  const samplesRaw = await getReviewSamples(game.reviewSetId);
  const samples: ReviewSampleForClient[] = samplesRaw.map(s => ({
    id: s.id,
    content: s.content,
    orderIndex: s.orderIndex,
  }));

  let teammates: { id: number; nickname: string }[] = [];
  const myScores: ReviewTeamState['myScores'] = {};
  const teammateScores: ReviewTeamState['teammateScores'] = {};
  let submission: ReviewTeamState['submission'] = null;
  let hasVoted = false;
  let votingCandidates: ReviewTeamState['votingCandidates'] = null;
  let finalTeamRank: ReviewTeamState['finalTeamRank'] = null;
  let teamName: string | null = null;

  if (me.teamId) {
    const [team] = await db
      .select({ teamName: reviewTeamSchema.teamName })
      .from(reviewTeamSchema)
      .where(eq(reviewTeamSchema.id, me.teamId))
      .limit(1);
    teamName = team?.teamName ?? null;

    const teamMembers = await db
      .select({ id: reviewPlayerSchema.id, nickname: reviewPlayerSchema.nickname })
      .from(reviewPlayerSchema)
      .where(eq(reviewPlayerSchema.teamId, me.teamId));
    teammates = teamMembers.filter(p => p.id !== me.id);

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
      submission = { content: sub.content, updatedAt: sub.updatedAt.toISOString() };
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

    if (game.status === 'results') {
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
    me: { id: me.id, nickname: me.nickname, teamId: me.teamId, teamName },
    teammates,
    samples,
    myScores,
    teammateScores,
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
  scores: RubricScores;
  comment: string | null;
}): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const { gameId, playerId, sampleId, scores, comment } = params;

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
  if (!game || game.status !== 'reviewing') {
    return { ok: false, error: 'NOT_REVIEWING_PHASE', status: 409 };
  }

  const [sample] = await db
    .select({ id: reviewSampleSchema.id })
    .from(reviewSampleSchema)
    .where(eq(reviewSampleSchema.id, sampleId))
    .limit(1);
  if (!sample) {
    return { ok: false, error: 'SAMPLE_NOT_FOUND', status: 404 };
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

  const [game] = await db
    .select({ status: reviewGameSchema.status })
    .from(reviewGameSchema)
    .where(eq(reviewGameSchema.id, gameId))
    .limit(1);
  if (!game || game.status !== 'creating') {
    return { ok: false, error: 'NOT_CREATING_PHASE', status: 409 };
  }

  await db
    .insert(reviewSubmissionSchema)
    .values({ teamId: player.teamId, content, lastEditedByPlayerId: playerId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: reviewSubmissionSchema.teamId,
      set: { content, lastEditedByPlayerId: playerId, updatedAt: new Date() },
    });

  await publishTick(gameId);
  return { ok: true };
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
    return { ok: false, error: 'ALREADY_VOTED', status: 409 };
  }

  await publishTick(gameId);
  return { ok: true };
}
