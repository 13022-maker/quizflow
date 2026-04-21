// Live Mode client-side Ably adapter：訂閱 tick 後 fetch REST 拿最新 state
// 跟 PollingRealtimeAdapter 同介面（LiveRealtimeAdapter），switch 透過 env flag 在 realtimeAdapter.ts
//
// 為什麼 tick → fetch 而不是直接 push state？
//   - 避免隱私洩漏（player state 含自己的分數/排名，push 到公開 channel 會被其他 client 偷看）
//   - 保留既有 REST endpoint 作為權威 state 來源
//   - tick 幾乎零 payload，Ably msg cost 極低
'use client';

import type * as AblyTypes from 'ably';

import type {
  LiveRealtimeAdapter,
  SubscribeHostOptions,
  SubscribePlayerOptions,
  Unsubscribe,
} from './realtimeAdapter';
import type {
  LiveHostState,
  LivePlayerState,
} from './types';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

// 動態 import Ably，避免把 ~200KB SDK 打進非 Live Mode 的路由 bundle
async function createRealtime(
  authParams: Record<string, string>,
): Promise<AblyTypes.Realtime> {
  const { default: Ably } = await import('ably');
  return new Ably.Realtime({
    authUrl: '/api/live/ably-auth',
    authParams,
    authMethod: 'GET',
  });
}

export class AblyRealtimeAdapter implements LiveRealtimeAdapter {
  subscribeHostState(
    gameId: number,
    cb: (state: LiveHostState) => void,
    opts?: SubscribeHostOptions,
  ): Unsubscribe {
    let cancelled = false;
    let realtime: AblyTypes.Realtime | null = null;
    const url = `/api/live/${gameId}/host-state`;

    const fetchAndCb = async () => {
      try {
        const state = await fetchJson<LiveHostState>(url);
        if (!cancelled) {
          cb(state);
        }
      } catch (err) {
        opts?.onError?.(err);
      }
    };

    (async () => {
      // 1. 初始 state 用 REST 拉
      await fetchAndCb();
      if (cancelled) {
        return;
      }

      // 2. 連 Ably 訂 tick
      try {
        realtime = await createRealtime({
          role: 'host',
          gameId: String(gameId),
        });
        const channel = realtime.channels.get(`live:${gameId}`);
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

  subscribePlayerState(
    gameId: number,
    playerId: number,
    playerToken: string,
    cb: (state: LivePlayerState) => void,
    opts?: SubscribePlayerOptions,
  ): Unsubscribe {
    let cancelled = false;
    let realtime: AblyTypes.Realtime | null = null;
    const url = `/api/live/${gameId}/player-state?playerId=${playerId}&token=${encodeURIComponent(playerToken)}`;

    const fetchAndCb = async () => {
      try {
        const state = await fetchJson<LivePlayerState>(url);
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
        const channel = realtime.channels.get(`live:${gameId}`);
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
