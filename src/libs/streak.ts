/**
 * 老師個人連勝（streak）計算工具
 *
 * 觸發時機：成功建立測驗時呼叫 recordStreakActivity()
 * 時區：台北（UTC+8，固定不做 DST）
 * 同一天多次呼叫只算一次（冪等）
 */

import { eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { userStreakSchema } from '@/models/Schema';

// 台北時區 UTC+8（無日光節約時間）
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// 回傳「該時間在台北時區屬於第幾天」的整數（自 epoch 起算的日編號）
// 用來做日差計算，不需要 Date 物件間的加減
function taipeiDayIndex(d: Date): number {
  return Math.floor((d.getTime() + TAIPEI_OFFSET_MS) / MS_PER_DAY);
}

// 里程碑（達到此天數時回傳給前端播慶祝動畫）
const MILESTONES = [7, 14, 30, 60, 100, 365];

export type StreakRecordResult = {
  currentStreak: number;
  longestStreak: number;
  isNewRecord: boolean; // 是否打破歷史最長
  milestone: number | null; // 達到哪個里程碑（沒達到為 null）
};

// 記錄一次「今天有活動」，回傳更新後狀態
export async function recordStreakActivity(clerkUserId: string): Promise<StreakRecordResult> {
  const now = new Date();
  const todayIdx = taipeiDayIndex(now);

  const [existing] = await db
    .select()
    .from(userStreakSchema)
    .where(eq(userStreakSchema.clerkUserId, clerkUserId))
    .limit(1);

  // 首次活動：建新紀錄
  if (!existing) {
    await db.insert(userStreakSchema).values({
      clerkUserId,
      currentStreak: 1,
      longestStreak: 1,
      lastActivityAt: now,
    });
    return {
      currentStreak: 1,
      longestStreak: 1,
      isNewRecord: true,
      milestone: MILESTONES.includes(1) ? 1 : null,
    };
  }

  // 從未活動過（正常情況很少，保險處理）
  if (!existing.lastActivityAt) {
    await db
      .update(userStreakSchema)
      .set({ currentStreak: 1, longestStreak: Math.max(1, existing.longestStreak), lastActivityAt: now })
      .where(eq(userStreakSchema.clerkUserId, clerkUserId));
    return {
      currentStreak: 1,
      longestStreak: Math.max(1, existing.longestStreak),
      isNewRecord: existing.longestStreak < 1,
      milestone: null,
    };
  }

  const lastIdx = taipeiDayIndex(existing.lastActivityAt);
  const dayDiff = todayIdx - lastIdx;

  // 同一天多次呼叫：冪等，不重複計算
  if (dayDiff === 0) {
    return {
      currentStreak: existing.currentStreak,
      longestStreak: existing.longestStreak,
      isNewRecord: false,
      milestone: null,
    };
  }

  let newStreak: number;
  let useFreeze = false;

  if (dayDiff === 1) {
    // 連續隔天：+1
    newStreak = existing.currentStreak + 1;
  } else if (dayDiff === 2 && existing.freezesLeft > 0) {
    // 中間漏了一天但還有補簽：+1 並扣一次補簽
    newStreak = existing.currentStreak + 1;
    useFreeze = true;
  } else {
    // 斷連：從 1 重新開始
    newStreak = 1;
  }

  const newLongest = Math.max(newStreak, existing.longestStreak);
  const isNewRecord = newStreak > existing.longestStreak;
  const milestone = MILESTONES.includes(newStreak) ? newStreak : null;

  await db
    .update(userStreakSchema)
    .set({
      currentStreak: newStreak,
      longestStreak: newLongest,
      lastActivityAt: now,
      ...(useFreeze
        ? { freezesLeft: existing.freezesLeft - 1, frozenUntil: now }
        : {}),
    })
    .where(eq(userStreakSchema.clerkUserId, clerkUserId));

  return { currentStreak: newStreak, longestStreak: newLongest, isNewRecord, milestone };
}

// 查詢目前狀態（無紀錄時回傳預設值）
export async function getStreak(clerkUserId: string) {
  const [streak] = await db
    .select()
    .from(userStreakSchema)
    .where(eq(userStreakSchema.clerkUserId, clerkUserId))
    .limit(1);

  if (!streak) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      freezesLeft: 0,
      lastActivityAt: null as Date | null,
    };
  }

  return {
    currentStreak: streak.currentStreak,
    longestStreak: streak.longestStreak,
    freezesLeft: streak.freezesLeft,
    lastActivityAt: streak.lastActivityAt,
  };
}

// 回傳本週（週一到週日）每天是否活動的 7 個 boolean
// 目前活動判定邏輯：從 lastActivityAt 往前推 currentStreak-1 天都算有活動
// 未來的日子一律 false（還沒到）
export async function getWeeklyActivity(clerkUserId: string): Promise<boolean[]> {
  const [streak] = await db
    .select()
    .from(userStreakSchema)
    .where(eq(userStreakSchema.clerkUserId, clerkUserId))
    .limit(1);

  const now = new Date();
  const todayIdx = taipeiDayIndex(now);

  // 找本週週一的 day index
  // 台北時區當下星期幾：0=Sun, 1=Mon, ... 6=Sat
  const taipeiNow = new Date(now.getTime() + TAIPEI_OFFSET_MS);
  const dow = taipeiNow.getUTCDay(); // 用 UTC 方法避免 JS 本機時區干擾
  const mondayOffset = dow === 0 ? -6 : 1 - dow; // 週日 = -6，其他 = 1-dow
  const mondayIdx = todayIdx + mondayOffset;

  if (!streak || !streak.lastActivityAt || streak.currentStreak <= 0) {
    // 無紀錄時，過去與未來皆 false（但仍要保留 7 格）
    return Array.from({ length: 7 }, () => false);
  }

  const lastIdx = taipeiDayIndex(streak.lastActivityAt);
  // 連勝涵蓋的最早日：lastIdx - (currentStreak - 1)
  const earliestActiveIdx = lastIdx - (streak.currentStreak - 1);

  const result: boolean[] = [];
  for (let i = 0; i < 7; i += 1) {
    const dayIdx = mondayIdx + i;
    if (dayIdx > todayIdx) {
      result.push(false); // 未來的日子
    } else {
      result.push(dayIdx >= earliestActiveIdx && dayIdx <= lastIdx);
    }
  }
  return result;
}
