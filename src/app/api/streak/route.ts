/**
 * Streak 查詢 API
 * 回傳當前使用者的連勝天數、最長紀錄、補簽次數、本週活動格
 */

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { getStreak, getWeeklyActivity } from '@/libs/streak';

export const runtime = 'nodejs';

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  try {
    const [streak, weeklyActivity] = await Promise.all([
      getStreak(userId),
      getWeeklyActivity(userId),
    ]);

    return NextResponse.json({
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
      freezesLeft: streak.freezesLeft,
      lastActivityAt: streak.lastActivityAt?.toISOString() ?? null,
      weeklyActivity,
    });
  } catch (err) {
    console.error('[Streak] 查詢失敗', err);
    return NextResponse.json({ error: '查詢失敗' }, { status: 500 });
  }
}
