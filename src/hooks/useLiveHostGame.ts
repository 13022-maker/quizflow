'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  endGame as endGameAction,
  nextQuestion as nextQuestionAction,
  showResult as showResultAction,
  startGame as startGameAction,
} from '@/actions/liveActions';
import { liveRealtime } from '@/services/live/realtimeAdapter';
import type { LiveHostState } from '@/services/live/types';

export function useLiveHostGame(gameId: number) {
  const [state, setState] = useState<LiveHostState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [skew, setSkew] = useState<number>(0); // localNow - serverNow

  // 依 seq 去重：較舊或重複的 state 直接丟棄
  const lastSeqRef = useRef<number>(-1);

  useEffect(() => {
    const unsub = liveRealtime.subscribeHostState(
      gameId,
      (s) => {
        if (s.seq <= lastSeqRef.current) {
          return; // stale
        }
        lastSeqRef.current = s.seq;
        setSkew(Date.now() - s.serverNow);
        setState(s);
        setError(null);
      },
      {
        intervalMs: 1500,
        onError: (err) => {
          setError(err instanceof Error ? err.message : 'network error');
        },
      },
    );
    return unsub;
  }, [gameId]);

  // 自癒 timer：本地 endsAt 到了就 POST /tick；server 端 atomic 推 phase 到 locked
  // 多個 client 同時 POST 也沒事（atomic UPDATE WHERE status='playing'，第一個贏）
  useEffect(() => {
    const endsAt = state?.game.questionEndsAt;
    if (!endsAt || state?.game.status !== 'playing') {
      return;
    }
    const localEndsAt = new Date(endsAt).getTime() + skew;
    const delay = Math.max(0, localEndsAt - Date.now() + 500); // +500ms 寬限避免比 server 早
    const timer = setTimeout(() => {
      void fetch(`/api/live/${gameId}/tick`, { method: 'POST' }).catch(() => {});
    }, delay);
    return () => clearTimeout(timer);
  }, [state?.game.questionEndsAt, state?.game.status, skew, gameId]);

  const runAction = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T> => {
      setPending(true);
      try {
        return await fn();
      } finally {
        setPending(false);
      }
    },
    [],
  );

  const start = useCallback(
    () => runAction(() => startGameAction(gameId)),
    [gameId, runAction],
  );
  const next = useCallback(
    () => runAction(() => nextQuestionAction(gameId)),
    [gameId, runAction],
  );
  const revealResult = useCallback(
    () => runAction(() => showResultAction(gameId)),
    [gameId, runAction],
  );
  const end = useCallback(
    () => runAction(() => endGameAction(gameId)),
    [gameId, runAction],
  );

  return {
    state,
    error,
    pending,
    skew,
    actions: { start, next, revealResult, end },
  };
}
