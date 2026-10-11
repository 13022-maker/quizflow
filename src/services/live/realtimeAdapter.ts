// Live Mode realtime 抽象層：hook / UI 透過這個介面訂閱狀態
// 提供兩種實作：
//   - PollingRealtimeAdapter：setInterval + fetch，不需外部服務，本機 dev 即用
//   - AblyRealtimeAdapter：透過 Ably 訂 tick，延遲 <100ms（需設 ABLY_API_KEY + NEXT_PUBLIC_LIVE_REALTIME=ably）
// 選擇邏輯在檔尾

import { AblyRealtimeAdapter } from './ablyAdapter';
import type { LiveBuzzerBoard, LiveHostState, LivePlayerState } from './types';

export type Unsubscribe = () => void;

/**
 * 小組搶答看板快照的處理結果：'handled' = 已直接套用（不用再打 REST）；
 * 'refetch' = 快照不夠用（例如已換題，題目內容只有 REST 有）→ adapter 改打 REST 重抓
 */
export type BoardHandlerResult = 'handled' | 'refetch';

// 輪詢間隔可以給函式：hook 依 state（例如小組搶答要快）動態調整，不必為了改間隔重新訂閱
export type IntervalOption = number | (() => number);

const resolveInterval = (v: IntervalOption | undefined, fallback: number) =>
  typeof v === 'function' ? v() : v ?? fallback;

export type SubscribeHostOptions = {
  intervalMs?: IntervalOption; // default 1500
  onError?: (err: unknown) => void;
  onBoard?: (board: LiveBuzzerBoard) => BoardHandlerResult; // 只有 Ably 會推看板；polling 無此訊息
};

export type SubscribePlayerOptions = {
  intervalMs?: IntervalOption; // default 2000
  onError?: (err: unknown) => void;
  onBoard?: (board: LiveBuzzerBoard) => BoardHandlerResult;
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
          timer = setTimeout(tick, resolveInterval(opts?.intervalMs, 1500));
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
          timer = setTimeout(tick, resolveInterval(opts?.intervalMs, 2000));
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

// 根據 env flag 選 adapter：NEXT_PUBLIC_LIVE_REALTIME=ably → Ably；其他 → polling
// 未設 NEXT_PUBLIC_LIVE_REALTIME 時預設 polling，零設定即可本機開發
function selectAdapter(): LiveRealtimeAdapter {
  if (process.env.NEXT_PUBLIC_LIVE_REALTIME === 'ably') {
    return new AblyRealtimeAdapter();
  }
  return new PollingRealtimeAdapter();
}

// 單例：Hook 層直接用
export const liveRealtime: LiveRealtimeAdapter = selectAdapter();
