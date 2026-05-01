'use server';

import { auth } from '@clerk/nextjs/server';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';

import { assertCanFork, ForkError, generateRoomCode } from '@/libs/fork';
import { insertForkedQuiz, loadSourceQuizByAccessCode } from '@/libs/fork-dao';

/**
 * 從「分享 Fork 連結」（/quiz/[accessCode]/fork 頁面）複製測驗。
 *
 * 與 marketplace Server Action 一致:**plan check 不啟用**(Free 也能用),
 * 其他規則(not-found / self-fork / visibility)走共用 assertCanFork。
 *
 * 共用 fork.ts / fork-dao.ts 核心,行為與 /api/quizzes/[id]/fork 對齊
 * (差別只在 plan gate)。
 */
export async function forkByAccessCode(accessCode: string) {
  const { userId } = await auth();
  if (!userId) {
    return { error: '請先登入' };
  }

  const source = await loadSourceQuizByAccessCode(accessCode);

  try {
    // isPro=true 跳過 plan gate;visibility / self-fork / not-found 規則照常
    assertCanFork(source, userId, true);

    const { newQuizId } = await insertForkedQuiz({
      source,
      ownerId: userId,
      codes: { accessCode: nanoid(8), roomCode: generateRoomCode() },
    });

    revalidatePath('/dashboard/quizzes');
    return { success: true, newQuizId };
  } catch (e) {
    if (e instanceof ForkError) {
      return { error: e.message };
    }
    throw e;
  }
}
