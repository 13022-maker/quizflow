// src/hooks/useReviewHeartbeat.ts
'use client';

import { useEffect } from 'react';

const HEARTBEAT_INTERVAL_MS = 5 * 1000;

/**
 * 學生端心跳：每 5s POST /api/review/[gameId]/heartbeat 更新 last_seen_at
 * @param gameId Review game 編號
 * @param playerToken server 在 /api/review/join 產生的學生身分 token
 * @param enabled false 時停止心跳（例如 game 已 ended）
 */
export function useReviewHeartbeat(gameId: number, playerToken: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    const tick = async () => {
      if (cancelled) {
        return;
      }
      try {
        await fetch(`/api/review/${gameId}/heartbeat`, {
          method: 'POST',
          headers: { 'x-player-token': playerToken },
        });
      } catch {
        // 網路 fail 吞掉；下次 tick 自動重試
      }
    };
    tick();
    const id = setInterval(tick, HEARTBEAT_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [gameId, playerToken, enabled]);
}
