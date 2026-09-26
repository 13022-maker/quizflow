// src/actions/reviewActions.ts
'use server';

import { auth } from '@clerk/nextjs/server';
import { and, count, eq, inArray } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  reviewGameSchema,
  reviewPlayerSchema,
  reviewScoreSchema,
  reviewSetSchema,
  reviewTeamSchema,
  reviewVoteSchema,
} from '@/models/Schema';
import { publishTick } from '@/services/review/ablyServer';
import { getReviewSamples } from '@/services/review/reviewStore';
import type { RubricScores } from '@/services/review/scoring';
import {
  calcAccuracyScore,
  calcSpeedBonus,
  calcTeamTotalScore,
  calcVoteBonus,
  distributeAccuracyPoints,
} from '@/services/review/scoring';
import { assignTeamsRoundRobin } from '@/services/review/teamAssignment';

// 生成 6 碼大寫英數 game pin（與 liveActions.ts 同邏輯）
function generatePin(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function generateUniquePin(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const pin = generatePin();
    const [existing] = await db
      .select({ id: reviewGameSchema.id })
      .from(reviewGameSchema)
      .where(eq(reviewGameSchema.gamePin, pin))
      .limit(1);
    if (!existing) {
      return pin;
    }
  }
  return generatePin() + Math.random().toString(36).slice(2, 3).toUpperCase();
}

async function loadOwnedReviewGame(gameId: number, userId: string) {
  const [game] = await db
    .select()
    .from(reviewGameSchema)
    .where(and(eq(reviewGameSchema.id, gameId), eq(reviewGameSchema.hostUserId, userId)))
    .limit(1);
  return game ?? null;
}

export async function createReviewGame(reviewSetId: number) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }

  const [reviewSet] = await db
    .select()
    .from(reviewSetSchema)
    .where(and(eq(reviewSetSchema.id, reviewSetId), eq(reviewSetSchema.ownerId, userId)))
    .limit(1);
  if (!reviewSet) {
    return { error: '找不到題組或沒有權限' };
  }

  const samples = await getReviewSamples(reviewSetId);
  if (samples.length === 0) {
    return { error: '這個題組還沒有範例答案，請先編輯新增' };
  }

  const gamePin = await generateUniquePin();
  const [inserted] = await db
    .insert(reviewGameSchema)
    .values({ reviewSetId, hostUserId: userId, gamePin })
    .returning();
  if (!inserted) {
    return { error: '建立場次失敗' };
  }

  return { ok: true as const, gameId: inserted.id, gamePin: inserted.gamePin };
}

export async function startTeamForming(gameId: number) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }
  const game = await loadOwnedReviewGame(gameId, userId);
  if (!game) {
    return { error: 'GAME_NOT_FOUND' };
  }
  if (game.status !== 'lobby') {
    return { error: 'ALREADY_STARTED' };
  }

  const [reviewSet] = await db
    .select({ teamSize: reviewSetSchema.teamSize })
    .from(reviewSetSchema)
    .where(eq(reviewSetSchema.id, game.reviewSetId))
    .limit(1);
  if (!reviewSet) {
    return { error: 'REVIEW_SET_NOT_FOUND' };
  }

  const players = await db
    .select({ id: reviewPlayerSchema.id })
    .from(reviewPlayerSchema)
    .where(eq(reviewPlayerSchema.gameId, gameId));
  if (players.length === 0) {
    return { error: 'NO_PLAYERS' };
  }

  const teamGroups = assignTeamsRoundRobin(players.map(p => p.id), reviewSet.teamSize);

  await db.transaction(async (tx) => {
    for (const [i, memberIds] of teamGroups.entries()) {
      const [team] = await tx
        .insert(reviewTeamSchema)
        .values({ gameId, teamName: `第 ${i + 1} 組` })
        .returning();
      if (!team) {
        continue;
      }
      await tx
        .update(reviewPlayerSchema)
        .set({ teamId: team.id })
        .where(inArray(reviewPlayerSchema.id, memberIds));
    }
    await tx
      .update(reviewGameSchema)
      .set({ status: 'team_forming' })
      .where(eq(reviewGameSchema.id, gameId));
  });

  await publishTick(gameId);
  return { ok: true as const };
}

export async function startReviewing(gameId: number) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }
  const game = await loadOwnedReviewGame(gameId, userId);
  if (!game) {
    return { error: 'GAME_NOT_FOUND' };
  }
  if (game.status !== 'team_forming') {
    return { error: 'WRONG_PHASE' };
  }

  const [reviewSet] = await db
    .select({ reviewDurationSec: reviewSetSchema.reviewDurationSec })
    .from(reviewSetSchema)
    .where(eq(reviewSetSchema.id, game.reviewSetId))
    .limit(1);
  if (!reviewSet) {
    return { error: 'REVIEW_SET_NOT_FOUND' };
  }

  const now = new Date();
  await db
    .update(reviewGameSchema)
    .set({
      status: 'reviewing',
      phaseStartedAt: now,
      phaseDurationSec: reviewSet.reviewDurationSec,
      reviewingStartedAt: now,
    })
    .where(eq(reviewGameSchema.id, gameId));

  await publishTick(gameId);
  return { ok: true as const };
}

export async function startCreating(gameId: number) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }
  const game = await loadOwnedReviewGame(gameId, userId);
  if (!game) {
    return { error: 'GAME_NOT_FOUND' };
  }
  if (game.status !== 'reviewing') {
    return { error: 'WRONG_PHASE' };
  }

  const [reviewSet] = await db
    .select({ createDurationSec: reviewSetSchema.createDurationSec })
    .from(reviewSetSchema)
    .where(eq(reviewSetSchema.id, game.reviewSetId))
    .limit(1);
  if (!reviewSet) {
    return { error: 'REVIEW_SET_NOT_FOUND' };
  }

  const now = new Date();
  await db
    .update(reviewGameSchema)
    .set({
      status: 'creating',
      phaseStartedAt: now,
      phaseDurationSec: reviewSet.createDurationSec,
      reviewingEndedAt: now, // 關閉 reviewing 時間窗，供速度加成計算
    })
    .where(eq(reviewGameSchema.id, gameId));

  await publishTick(gameId);
  return { ok: true as const };
}

export async function startVoting(gameId: number) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }
  const game = await loadOwnedReviewGame(gameId, userId);
  if (!game) {
    return { error: 'GAME_NOT_FOUND' };
  }
  if (game.status !== 'creating') {
    return { error: 'WRONG_PHASE' };
  }

  await db
    .update(reviewGameSchema)
    .set({ status: 'voting', phaseStartedAt: null, phaseDurationSec: null })
    .where(eq(reviewGameSchema.id, gameId));

  await publishTick(gameId);
  return { ok: true as const };
}

export async function finishGame(gameId: number) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }
  const game = await loadOwnedReviewGame(gameId, userId);
  if (!game) {
    return { error: 'GAME_NOT_FOUND' };
  }
  if (game.status !== 'voting') {
    return { error: 'WRONG_PHASE' };
  }

  const samples = await getReviewSamples(game.reviewSetId);
  const accuracyPoints = distributeAccuracyPoints(samples.length);
  const teams = await db.select().from(reviewTeamSchema).where(eq(reviewTeamSchema.gameId, gameId));

  await db.transaction(async (tx) => {
    for (const team of teams) {
      const members = await tx
        .select({ id: reviewPlayerSchema.id })
        .from(reviewPlayerSchema)
        .where(eq(reviewPlayerSchema.teamId, team.id));
      const scores = await tx
        .select()
        .from(reviewScoreSchema)
        .where(eq(reviewScoreSchema.teamId, team.id));

      let accuracyTotal = 0;
      for (const [i, sample] of samples.entries()) {
        const sampleScores = scores.filter(s => s.sampleId === sample.id);
        if (sampleScores.length === 0) {
          continue;
        }
        const avg: RubricScores = {
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
        accuracyTotal += calcAccuracyScore(avg, ref, accuracyPoints[i]!);
      }

      // 速度加成：全員對全部範例答案都交齊才算「該組完成」
      const fullyCompleted
        = members.length > 0 && samples.length > 0 && scores.length >= members.length * samples.length;
      let speedBonus = 0;
      if (fullyCompleted && game.reviewingStartedAt && game.reviewingEndedAt && scores.length > 0) {
        const lastSubmittedAt = scores.reduce(
          (max, s) => (s.submittedAt > max ? s.submittedAt : max),
          scores[0]!.submittedAt,
        );
        const elapsedSec = (lastSubmittedAt.getTime() - game.reviewingStartedAt.getTime()) / 1000;
        const totalDurationSec = (game.reviewingEndedAt.getTime() - game.reviewingStartedAt.getTime()) / 1000;
        speedBonus = calcSpeedBonus(elapsedSec, totalDurationSec);
      }

      const votesRows = await tx
        .select({ value: count() })
        .from(reviewVoteSchema)
        .where(eq(reviewVoteSchema.votedForTeamId, team.id));
      // count() 一定回傳剛好一列，noUncheckedIndexedAccess 逼型別檢查用 ! 斷言
      const voteBonus = calcVoteBonus(votesRows[0]!.value);

      const total = calcTeamTotalScore({
        accuracyScores: [accuracyTotal],
        speedBonus,
        voteBonus,
      });

      await tx
        .update(reviewTeamSchema)
        .set({ accuracyScore: accuracyTotal, speedBonus, voteBonus, score: total })
        .where(eq(reviewTeamSchema.id, team.id));
    }

    await tx.update(reviewGameSchema).set({ status: 'results' }).where(eq(reviewGameSchema.id, gameId));
  });

  await publishTick(gameId);
  return { ok: true as const };
}

export async function endGame(gameId: number) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }
  const game = await loadOwnedReviewGame(gameId, userId);
  if (!game) {
    return { error: 'GAME_NOT_FOUND' };
  }

  await db
    .update(reviewGameSchema)
    .set({ status: 'ended', endedAt: new Date() })
    .where(eq(reviewGameSchema.id, gameId));

  await publishTick(gameId);
  return { ok: true as const };
}
