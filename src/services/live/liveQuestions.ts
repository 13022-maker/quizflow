// Live Mode 題目讀取：獨立成一支，讓 liveStore 與 buzzerStore 都能用而不互相 import（避免循環相依）

import { asc, eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { questionSchema } from '@/models/Schema';

import { isBuzzerSupportedType } from './buzzer';
import { isLiveSupportedType } from './scoring';
import type { LiveGameMode, LiveQuestionForHost } from './types';

// 取得某 game 的題目清單（依 position 排序，只含 Live Mode 支援的題型）
export async function getLiveQuestions(quizId: number): Promise<LiveQuestionForHost[]> {
  const rows = await db
    .select({
      id: questionSchema.id,
      type: questionSchema.type,
      body: questionSchema.body,
      imageUrl: questionSchema.imageUrl,
      audioUrl: questionSchema.audioUrl,
      audioDurationSec: questionSchema.audioDurationSec,
      options: questionSchema.options,
      correctAnswers: questionSchema.correctAnswers,
      position: questionSchema.position,
    })
    .from(questionSchema)
    .where(eq(questionSchema.quizId, quizId))
    .orderBy(asc(questionSchema.position));

  return rows
    .filter(r => isLiveSupportedType(r.type))
    .map(r => ({
      id: r.id,
      type: r.type as 'single_choice' | 'multiple_choice' | 'true_false' | 'listening',
      body: r.body,
      imageUrl: r.imageUrl,
      audioUrl: r.audioUrl,
      audioDurationSec: r.audioDurationSec,
      options: (r.options ?? []) as { id: string; text: string }[],
      correctAnswers: (r.correctAnswers ?? []) as string[],
    }));
}

// 依玩法取題：小組搶答排除聽力題；classic 與 getLiveQuestions 完全相同
export async function getGameQuestions(
  quizId: number,
  gameMode: LiveGameMode,
): Promise<LiveQuestionForHost[]> {
  const questions = await getLiveQuestions(quizId);
  return gameMode === 'team_buzzer'
    ? questions.filter(q => isBuzzerSupportedType(q.type))
    : questions;
}
