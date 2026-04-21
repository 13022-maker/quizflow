// Live Mode realtime 抽象層
// 目前僅提供 short polling 實作，Hook / UI 透過這個介面訂閱狀態。
// 未來可換成 Supabase Realtime / Socket.IO 而不需改 hook 以上。

import type { LiveHostState, LivePlayerState } from './types';

export type Unsubscribe = () => void;

export type SubscribeHostOptions = {
  intervalMs?: number; // default 1500
  onError?: (err: unknown) => void;
};

export type SubscribePlayerOptions = {
  intervalMs?: number; // default 2000
  onError?: (err: unknown) => void;
};

export type LiveRealtimeAdapter = {
  subscribeHostState: (
    gameId: number,
    cb: (state: LiveHostState) => void,
    opts?: SubscribeHostOptions,
  ) => Unsubscribe;
  subscribePlayerState: (
    gameId: number,
    playerId: number,
    playerToken: string,
    cb: (state: LivePlayerState) => void,
    opts?: SubscribePlayerOptions,
  ) => Unsubscribe;
};

// ── Polling 實作：setInterval + fetch ─────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export class PollingRealtimeAdapter implements LiveRealtimeAdapter {
  subscribeHostState(
    gameId: number,
    cb: (state: LiveHostState) => void,
    opts?: SubscribeHostOptions,
  ): Unsubscribe {
    const intervalMs = opts?.intervalMs ?? 1500;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) {
        return;
      }
      try {
        const state = await fetchJson<LiveHostState>(`/api/live/${gameId}/host-state`);
        if (!cancelled) {
          cb(state);
        }
      } catch (err) {
        opts?.onError?.(err);
      } finally {
        if (!cancelled) {
          timer = setTimeout(tick, intervalMs);
        }
      }
    };

    // 立即跑一次，之後再進 interval
    tick();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }

  subscribePlayerState(
    gameId: number,
    playerId: number,
    playerToken: string,
    cb: (state: LivePlayerState) => void,
    opts?: SubscribePlayerOptions,
  ): Unsubscribe {
    const intervalMs = opts?.intervalMs ?? 2000;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const url = `/api/live/${gameId}/player-state?playerId=${playerId}&token=${encodeURIComponent(playerToken)}`;

    const tick = async () => {
      if (cancelled) {
        return;
      }
      try {
        const state = await fetchJson<LivePlayerState>(url);
        if (!cancelled) {
          cb(state);
        }
      } catch (err) {
        opts?.onError?.(err);
      } finally {
        if (!cancelled) {
          timer = setTimeout(tick, intervalMs);
        }
      }
    };

    tick();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }
}

// 單例：Hook 層直接用
export const liveRealtime: LiveRealtimeAdapter = new PollingRealtimeAdapter();
