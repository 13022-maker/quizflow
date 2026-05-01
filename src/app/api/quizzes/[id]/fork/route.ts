// POST /api/quizzes/[id]/fork
// 把指定 source quiz 複製成一份新的 private draft（標題加「（副本）」後綴）
// 業務規則 / 純邏輯在 @/libs/fork,DB 寫入在 @/libs/fork-dao,本檔只負責:
//   1. params 驗證（Zod）
//   2. Clerk auth + Pro 檢查
//   3. 業務錯誤對應 HTTP status
//   4. 注入 accessCode / roomCode

import { auth } from '@clerk/nextjs/server';
import { nanoid } from 'nanoid';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  assertCanFork,
  ForkError,
  type ForkErrorCode,
  generateRoomCode,
} from '@/libs/fork';
import { insertForkedQuiz, loadSourceQuiz } from '@/libs/fork-dao';
import { isProOrAbove } from '@/libs/Plan';

export const runtime = 'nodejs';

// 業務錯誤代碼對應 HTTP status
const FORK_ERROR_HTTP: Record<ForkErrorCode, number> = {
  'not-found': 404,
  'plan': 403,
  'self-fork': 403,
  'visibility': 403,
};

// params.id 必須為純數字字串
const ParamsSchema = z.object({
  id: z.string().regex(/^\d+$/, 'id 必須為數字'),
});

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  // 1) params 驗證
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: 'id 格式錯誤' }, { status: 400 });
  }
  const sourceId = Number(parsed.data.id);

  // 2) Clerk auth
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  try {
    // 3) 載入 source + 業務規則檢查（資源存在 → Pro → self-fork → visibility）
    const source = await loadSourceQuiz(sourceId);
    const isPro = await isProOrAbove(userId);
    assertCanFork(source, userId, isPro);

    // 4) DB transaction 內 insert quiz + questions + source.forkCount += 1
    const { newQuizId } = await insertForkedQuiz({
      source,
      ownerId: userId,
      codes: { accessCode: nanoid(8), roomCode: generateRoomCode() },
    });

    return NextResponse.json({
      newQuizId,
      redirectUrl: `/dashboard/quizzes/${newQuizId}/edit`,
    });
  } catch (e) {
    if (e instanceof ForkError) {
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: FORK_ERROR_HTTP[e.code] },
      );
    }
    // TODO(post-MVP): rate limit per userId via Vercel runtime cache
    console.error('fork failed', e);
    return NextResponse.json({ error: '複製失敗' }, { status: 500 });
  }
}
