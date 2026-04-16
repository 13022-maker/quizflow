/**
 * Streak 手動記錄 API
 * 目前主要觸發是 createQuiz server action 直接呼叫 recordStreakActivity，
 * 此 route 保留供未來擴充（例如學生端 / 其他行為觸發）
 */

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { recordStreakActivity } from '@/libs/streak';

export const runtime = 'nodejs';

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  try {
    const result = await recordStreakActivity(userId);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[Streak] 記錄失敗', err);
    return NextResponse.json({ error: '記錄失敗' }, { status: 500 });
  }
}
