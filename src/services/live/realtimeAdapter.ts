// Live Mode realtime 抽象層
// 以 Ably 為底，維持原本 LiveRealtimeAdapter 介面讓 hook 幾乎不用改。
//
// 設計：
// 1. subscribe 時先打 REST /host-state 或 /player-state 做初次 hydrate
// 2. 連上 Ably channel 訂閱事件：
//    - 階段轉換事件（quiz:start / question:next / question:result / game:finished）
//      → 一律觸發 re-hydrate（避免 state shape 複雜化，也能處理 host 需要 correctAnswers 的情境）
//    - leaderboard:update → 直接 patch 本地 state.players，不打 REST
//    - answer:submitted（player 私人 channel）→ patch state.me.score / correctCount
// 3. Ably 斷線重連：channel.on('attached') 在非首次 attach 時 re-hydrate 補漏
// 4. publish 動作都在 server 端（REST），client 只 subscribe

'use client';

import type * as AblyNs from 'ably';

import { gameChannel, playerChannel } from '@/libs/ably/channels';

import {
  type AnswerSubmittedPayload,
  type LeaderboardUpdatePayload,
  LiveGameEvent,
  type LiveHostState,
  LivePlayerEvent,
  type LivePlayerState,
} from './types';

export type Unsubscribe = () => void;

export type SubscribeHostOptions = {
  onError?: (err: unknown) => void;
};

export type SubscribePlayerOptions = {
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

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

type LiveGameEventName = typeof LiveGameEvent[keyof typeof LiveGameEvent];
type LivePlayerEventName = typeof LivePlayerEvent[keyof typeof LivePlayerEvent];

// 所有會觸發 re-hydrate 的階段轉換事件
const PHASE_EVENTS: readonly LiveGameEventName[] = [
  LiveGameEvent.QuizStart,
  LiveGameEvent.QuestionNext,
  LiveGameEvent.QuestionResult,
  LiveGameEvent.GameFinished,
];

export class AblyRealtimeAdapter implements LiveRealtimeAdapter {
  subscribeHostState(
    gameId: number,
    cb: (state: LiveHostState) => void,
    opts?: SubscribeHostOptions,
  ): Unsubscribe {
    let cancelled = false;
    let state: LiveHostState | null = null;
    let realtime: AblyNs.Realtime | null = null;
    let channel: AblyNs.RealtimeChannel | null = null;

    const emit = () => {
      if (!cancelled && state) {
        cb(state);
      }
    };

    const hydrate = async () => {
      try {
        const fresh = await fetchJson<LiveHostState>(`/api/live/${gameId}/host-state`);
        if (!cancelled) {
          state = fresh;
          emit();
        }
      } catch (err) {
        opts?.onError?.(err);
      }
    };

    const onPhaseEvent = () => {
      // 任一階段轉換 → re-hydrate（含 correctAnswers 等只能從 REST 拿的欄位）
      hydrate();
    };

    const onLeaderboard = (msg: AblyNs.Message) => {
      const p = msg.data as LeaderboardUpdatePayload;
      if (!state) {
        return;
      }
      // payload 是精簡版（rank 已算好），轉成 LivePlayerSummary 維持 hook 以上 state 形狀
      state = {
        ...state,
        players: p.players.map(e => ({
          id: e.playerId,
          nickname: e.studentName,
          score: e.score,
          correctCount: e.answeredCount, // 這裡借用 correctCount 欄位顯示已答題數；host UI 只看 score 排名
        })),
        answeredCount: p.answeredCount,
      };
      emit();
    };

    (async () => {
      try {
        const { createRealtime } = await import('@/libs/ably/client');
        if (cancelled) {
          return;
        }
        realtime = await createRealtime({ kind: 'host', gameId });
        channel = realtime.channels.get(gameChannel(gameId));

        for (const ev of PHASE_EVENTS) {
          channel.subscribe(ev, onPhaseEvent);
        }
        channel.subscribe(LiveGameEvent.LeaderboardUpdate, onLeaderboard);

        let hasAttached = false;
        channel.on('attached', () => {
          if (hasAttached) {
            // 重連後 re-hydrate 補漏
            hydrate();
          }
          hasAttached = true;
        });

        await hydrate();
      } catch (err) {
        opts?.onError?.(err);
      }
    })();

    return () => {
      cancelled = true;
      if (channel) {
        for (const ev of PHASE_EVENTS) {
          channel.unsubscribe(ev, onPhaseEvent);
        }
        channel.unsubscribe(LiveGameEvent.LeaderboardUpdate, onLeaderboard);
        channel.detach().catch(() => {});
      }
      if (realtime) {
        realtime.close();
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
    let state: LivePlayerState | null = null;
    let realtime: AblyNs.Realtime | null = null;
    let gameCh: AblyNs.RealtimeChannel | null = null;
    let playerCh: AblyNs.RealtimeChannel | null = null;

    const url = `/api/live/${gameId}/player-state?playerId=${playerId}&token=${encodeURIComponent(playerToken)}`;

    const emit = () => {
      if (!cancelled && state) {
        cb(state);
      }
    };

    const hydrate = async () => {
      try {
        const fresh = await fetchJson<LivePlayerState>(url);
        if (!cancelled) {
          state = fresh;
          emit();
        }
      } catch (err) {
        opts?.onError?.(err);
      }
    };

    const onPhaseEvent = () => hydrate();

    const onLeaderboard = (msg: AblyNs.Message) => {
      const p = msg.data as LeaderboardUpdatePayload;
      if (!state) {
        return;
      }
      // finished 階段才 render leaderboard；其他階段只更新 me.rank / me.score
      const myEntry = p.players.find(e => e.playerId === state!.me.id);
      state = {
        ...state,
        me: myEntry
          ? {
              ...state.me,
              score: myEntry.score,
              rank: myEntry.rank,
            }
          : state.me,
        leaderboard: p.players.map(e => ({
          id: e.playerId,
          nickname: e.studentName,
          score: e.score,
          correctCount: e.answeredCount,
        })),
      };
      emit();
    };

    const onAnswerSubmitted = (msg: AblyNs.Message) => {
      const p = msg.data as AnswerSubmittedPayload;
      if (!state || !state.currentQuestion || state.currentQuestion.id !== p.questionId) {
        return;
      }
      state = {
        ...state,
        me: {
          ...state.me,
          score: p.totalScore,
          correctCount: p.correctCount,
        },
        myAnswer: {
          // selectedOptionId 在 server 端已知但此處不重要，UI 只看 isCorrect/score
          selectedOptionId: state.myAnswer?.selectedOptionId ?? null,
          isCorrect: p.isCorrect,
          score: p.score,
        },
      };
      emit();
    };

    (async () => {
      try {
        const { createRealtime } = await import('@/libs/ably/client');
        if (cancelled) {
          return;
        }
        realtime = await createRealtime({
          kind: 'player',
          gameId,
          playerId,
          playerToken,
        });
        gameCh = realtime.channels.get(gameChannel(gameId));
        playerCh = realtime.channels.get(playerChannel(gameId, playerId));

        for (const ev of PHASE_EVENTS) {
          gameCh.subscribe(ev, onPhaseEvent);
        }
        gameCh.subscribe(LiveGameEvent.LeaderboardUpdate, onLeaderboard);
        playerCh.subscribe(LivePlayerEvent.AnswerSubmitted, onAnswerSubmitted);

        let hasAttached = false;
        gameCh.on('attached', () => {
          if (hasAttached) {
            hydrate();
          }
          hasAttached = true;
        });

        await hydrate();
      } catch (err) {
        opts?.onError?.(err);
      }
    })();

    return () => {
      cancelled = true;
      if (gameCh) {
        for (const ev of PHASE_EVENTS) {
          gameCh.unsubscribe(ev, onPhaseEvent);
        }
        gameCh.unsubscribe(LiveGameEvent.LeaderboardUpdate, onLeaderboard);
        gameCh.detach().catch(() => {});
      }
      if (playerCh) {
        playerCh.unsubscribe(LivePlayerEvent.AnswerSubmitted, onAnswerSubmitted);
        playerCh.detach().catch(() => {});
      }
      if (realtime) {
        realtime.close();
      }
    };
  }
}

// unused but exported for tests / future override
export type { LiveGameEventName, LivePlayerEventName };

// 單例：Hook 層直接用
export const liveRealtime: LiveRealtimeAdapter = new AblyRealtimeAdapter();
