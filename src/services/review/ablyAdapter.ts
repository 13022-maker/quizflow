// src/services/review/ablyAdapter.ts
'use client';

import type * as AblyTypes from 'ably';

import type {
  ReviewRealtimeAdapter,
  SubscribeHostOptions,
  SubscribeTeamOptions,
  Unsubscribe,
} from './realtimeAdapter';
import type { ReviewHostState, ReviewTeamState } from './types';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

async function createRealtime(
  authParams: Record<string, string>,
): Promise<AblyTypes.Realtime> {
  const { default: Ably } = await import('ably');
  return new Ably.Realtime({
    authUrl: '/api/review/ably-auth',
    authParams,
    authMethod: 'GET',
  });
}

export class AblyRealtimeAdapter implements ReviewRealtimeAdapter {
  subscribeHostState(
    gameId: number,
    cb: (state: ReviewHostState) => void,
    opts?: SubscribeHostOptions,
  ): Unsubscribe {
    let cancelled = false;
    let realtime: AblyTypes.Realtime | null = null;
    const url = `/api/review/${gameId}/host-state`;

    const fetchAndCb = async () => {
      try {
        const state = await fetchJson<ReviewHostState>(url);
        if (!cancelled) {
          cb(state);
        }
      } catch (err) {
        opts?.onError?.(err);
      }
    };

    (async () => {
      await fetchAndCb();
      if (cancelled) {
        return;
      }
      try {
        realtime = await createRealtime({ role: 'host', gameId: String(gameId) });
        const channel = realtime.channels.get(`review:${gameId}`);
        await channel.subscribe('tick', () => {
          void fetchAndCb();
        });
      } catch (err) {
        opts?.onError?.(err);
      }
    })();

    return () => {
      cancelled = true;
      if (realtime) {
        realtime.close();
        realtime = null;
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
    let cancelled = false;
    let realtime: AblyTypes.Realtime | null = null;
    const url = `/api/review/${gameId}/team-state?playerId=${playerId}&token=${encodeURIComponent(playerToken)}`;

    const fetchAndCb = async () => {
      try {
        const state = await fetchJson<ReviewTeamState>(url);
        if (!cancelled) {
          cb(state);
        }
      } catch (err) {
        opts?.onError?.(err);
      }
    };

    (async () => {
      await fetchAndCb();
      if (cancelled) {
        return;
      }
      try {
        realtime = await createRealtime({
          role: 'player',
          gameId: String(gameId),
          playerId: String(playerId),
          playerToken,
        });
        const channel = realtime.channels.get(`review:${gameId}`);
        await channel.subscribe('tick', () => {
          void fetchAndCb();
        });
      } catch (err) {
        opts?.onError?.(err);
      }
    })();

    return () => {
      cancelled = true;
      if (realtime) {
        realtime.close();
        realtime = null;
      }
    };
  }
}
