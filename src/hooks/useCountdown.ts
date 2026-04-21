'use client';

import { useEffect, useState } from 'react';

/**
 * 依據題目開始時間 (ISO string) + 秒數倒數，回傳剩餘秒數。
 * 不依賴 polling — 純 client 計時，每 100ms 更新一次（≈ 10fps）。
 */
export function useCountdown(
  startedAtIso: string | null,
  durationSec: number,
): { remaining: number; elapsed: number; percent: number } {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!startedAtIso) {
      return;
    }
    const id = setInterval(() => {
      setNow(Date.now());
    }, 100);
    return () => clearInterval(id);
  }, [startedAtIso]);

  if (!startedAtIso) {
    return { remaining: durationSec, elapsed: 0, percent: 0 };
  }

  const startMs = new Date(startedAtIso).getTime();
  const elapsedMs = Math.max(0, now - startMs);
  const totalMs = durationSec * 1000;
  const remainingMs = Math.max(0, totalMs - elapsedMs);
  const remaining = Math.ceil(remainingMs / 1000);
  const elapsed = Math.floor(elapsedMs / 1000);
  const percent = Math.min(100, Math.round((elapsedMs / totalMs) * 100));

  return { remaining, elapsed, percent };
}
