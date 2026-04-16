'use client';

/**
 * StreakCard — Dashboard 顯示老師連勝天數與本週活動格
 * 資料來源：GET /api/streak
 */

import { useEffect, useState } from 'react';

type StreakData = {
  currentStreak: number;
  longestStreak: number;
  freezesLeft: number;
  weeklyActivity: boolean[]; // 週一到週日，7 個 boolean
};

// 台北時區今天是星期幾（0=週日 1=週一 ... 6=週六）
function getTaipeiDayOfWeek(): number {
  const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
  const taipeiNow = new Date(Date.now() + TAIPEI_OFFSET_MS);
  return taipeiNow.getUTCDay();
}

export function StreakCard() {
  const [data, setData] = useState<StreakData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/streak')
      .then((r) => {
        if (!r.ok) {
          throw new Error('fetch streak failed');
        }
        return r.json();
      })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) {
    return null; // 失敗時不顯示，避免干擾主要內容
  }

  if (!data) {
    return <div className="h-28 animate-pulse rounded-xl border bg-card p-5" aria-label="載入中" />;
  }

  // 週一到週日標籤，對應 weeklyActivity[0..6]
  const DAYS = ['一', '二', '三', '四', '五', '六', '日'];
  // 將台北今天轉成「週一 index」：週一=0, 週二=1, ..., 週日=6
  const dow = getTaipeiDayOfWeek(); // 0=Sun ... 6=Sat
  const todayIndex = dow === 0 ? 6 : dow - 1;

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden="true">🔥</span>
          <div>
            <p className="text-2xl font-semibold leading-none">
              {data.currentStreak}
              <span className="ml-1 text-sm font-normal text-muted-foreground">天連勝</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              最長紀錄：
              {data.longestStreak}
              {' '}
              天
            </p>
          </div>
        </div>
        {data.freezesLeft > 0 && (
          <div className="flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-600">
            <span aria-hidden="true">❄️</span>
            <span>
              補簽 ×
              {data.freezesLeft}
            </span>
          </div>
        )}
      </div>

      {/* 本週七格 */}
      <div className="flex gap-1.5">
        {DAYS.map((day, i) => {
          const isActive = data.weeklyActivity[i];
          const isToday = i === todayIndex;
          const isFuture = i > todayIndex;
          const cellClass = isFuture
            ? 'bg-muted/30'
            : isActive
              ? 'bg-orange-400'
              : 'bg-muted';
          const ringClass = isToday && isActive ? 'ring-2 ring-orange-400 ring-offset-1' : '';
          return (
            <div key={day} className="flex flex-1 flex-col items-center gap-1">
              <div className={`aspect-square w-full rounded ${cellClass} ${ringClass}`} />
              <span className={`text-[10px] ${isToday ? 'font-medium' : 'text-muted-foreground'}`}>
                {day}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
