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
  LiveBuzzerBoard,
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

/**
 * 連 Ably 並訂閱 live:{gameId}：
 *   - tick：照舊 fetch REST
 *   - board（小組搶答完整看板）：交給 onBoard 直接套用，免一次 REST round trip；沒有 onBoard 或回 'refetch' 才 fetch
 *   - 斷線後重新 attach 且訊息沒能接續（resumed=false）→ 可能漏了訊息，fetch 一次 REST 校正
 */
async function connect(
  authParams: Record<string, string>,
  fetchAndCb: () => Promise<void>,
  opts: SubscribeHostOptions | SubscribePlayerOptions | undefined,
  isCancelled: () => boolean,
  setRealtime: (r: AblyTypes.Realtime) => void,
): Promise<void> {
  try {
    const realtime = await createRealtime(authParams);
    if (isCancelled()) {
      realtime.close();
      return;
    }
    setRealtime(realtime);
    const channel = realtime.channels.get(`live:${authParams.gameId}`);
    let firstAttach = true;
    channel.on('attached', (change) => {
      if (firstAttach) {
        firstAttach = false; // 第一次 attach 前的 state 已由初始 REST 負責
        return;
      }
      if (!change.resumed) {
        void fetchAndCb();
      }
    });
    await channel.subscribe((msg) => {
      if (msg.name === 'tick') {
        void fetchAndCb();
        return;
      }
      if (msg.name === 'board') {
        const handled = opts?.onBoard?.(msg.data as LiveBuzzerBoard);
        if (handled !== 'handled') {
          void fetchAndCb();
        }
      }
    });
  } catch (err) {
    opts?.onError?.(err);
  }
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

    // 初始 REST 與 Ably 連線同時進行（原本先等 REST 回來才開始連 Ably，冷啟動多等一整段）
    void fetchAndCb();
    void connect({ role: 'host', gameId: String(gameId) }, fetchAndCb, opts, () => cancelled, (r) => {
      realtime = r;
    });

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

    void fetchAndCb();
    void connect(
      { role: 'player', gameId: String(gameId), playerId: String(playerId), playerToken },
      fetchAndCb,
      opts,
      () => cancelled,
      (r) => {
        realtime = r;
      },
    );

    return () => {
      cancelled = true;
      if (realtime) {
        realtime.close();
        realtime = null;
      }
    };
  }
}
