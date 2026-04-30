'use client';

import { useEffect } from 'react';

const HEARTBEAT_INTERVAL_MS = 5 * 1000;

/**
 * 學生端心跳：每 5s POST /api/live/[gameId]/heartbeat 更新 last_seen_at
 * @param gameId Live game 編號
 * @param playerToken server 在 /api/live/join 產生的學生身分 token
 * @param enabled false 時停止心跳（例如 game 已 finished）
 */
export function useLiveHeartbeat(
  gameId: number,
  playerToken: string,
  enabled: boolean,
) {
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
        await fetch(`/api/live/${gameId}/heartbeat`, {
          method: 'POST',
          headers: { 'x-player-token': playerToken },
        });
      } catch {
        // 網路 fail 吞掉；下次 tick 自動重試。reconnect banner 由 useLivePlayerGame 負責
      }
    };
    tick(); // 立即先打一次
    const id = setInterval(tick, HEARTBEAT_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [gameId, playerToken, enabled]);
}
