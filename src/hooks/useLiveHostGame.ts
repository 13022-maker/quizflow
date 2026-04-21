'use client';

import { useCallback, useEffect, useState } from 'react';

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

  useEffect(() => {
    const unsub = liveRealtime.subscribeHostState(
      gameId,
      (s) => {
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
    actions: { start, next, revealResult, end },
  };
}
