// src/services/review/realtimeAdapter.ts
import { AblyRealtimeAdapter } from './ablyAdapter';
import type { ReviewHostState, ReviewTeamState } from './types';

export type Unsubscribe = () => void;

export type SubscribeHostOptions = {
  intervalMs?: number; // default 1500
  onError?: (err: unknown) => void;
};

export type SubscribeTeamOptions = {
  intervalMs?: number; // default 2000
  onError?: (err: unknown) => void;
};

export type ReviewRealtimeAdapter = {
  subscribeHostState: (
    gameId: number,
    cb: (state: ReviewHostState) => void,
    opts?: SubscribeHostOptions,
  ) => Unsubscribe;
  subscribeTeamState: (
    gameId: number,
    playerId: number,
    playerToken: string,
    cb: (state: ReviewTeamState) => void,
    opts?: SubscribeTeamOptions,
  ) => Unsubscribe;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export class PollingRealtimeAdapter implements ReviewRealtimeAdapter {
  subscribeHostState(
    gameId: number,
    cb: (state: ReviewHostState) => void,
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
        const state = await fetchJson<ReviewHostState>(`/api/review/${gameId}/host-state`);
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

  subscribeTeamState(
    gameId: number,
    playerId: number,
    playerToken: string,
    cb: (state: ReviewTeamState) => void,
    opts?: SubscribeTeamOptions,
  ): Unsubscribe {
    const intervalMs = opts?.intervalMs ?? 2000;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const url = `/api/review/${gameId}/team-state?playerId=${playerId}&token=${encodeURIComponent(playerToken)}`;

    const tick = async () => {
      if (cancelled) {
        return;
      }
      try {
        const state = await fetchJson<ReviewTeamState>(url);
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

function selectAdapter(): ReviewRealtimeAdapter {
  if (process.env.NEXT_PUBLIC_LIVE_REALTIME === 'ably') {
    return new AblyRealtimeAdapter();
  }
  return new PollingRealtimeAdapter();
}

export const reviewRealtime: ReviewRealtimeAdapter = selectAdapter();
