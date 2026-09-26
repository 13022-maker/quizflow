// src/hooks/useReviewHostGame.ts
'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  endGame as endGameAction,
  finishGame as finishGameAction,
  startCreating as startCreatingAction,
  startReviewing as startReviewingAction,
  startTeamForming as startTeamFormingAction,
  startVoting as startVotingAction,
} from '@/actions/reviewActions';
import { reviewRealtime } from '@/services/review/realtimeAdapter';
import type { ReviewHostState } from '@/services/review/types';

/**
 * 老師主控台 hook：透過 reviewRealtime 訂閱 host state（polling 或 Ably tick）
 * 並提供各階段切換 Server Action 的包裝（統一管理 pending 狀態）。
 */
export function useReviewHostGame(gameId: number) {
  const [state, setState] = useState<ReviewHostState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const unsub = reviewRealtime.subscribeHostState(
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

  const runAction = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
    setPending(true);
    try {
      return await fn();
    } finally {
      setPending(false);
    }
  }, []);

  const startTeamForming = useCallback(
    () => runAction(() => startTeamFormingAction(gameId)),
    [gameId, runAction],
  );
  const startReviewing = useCallback(
    () => runAction(() => startReviewingAction(gameId)),
    [gameId, runAction],
  );
  const startCreating = useCallback(
    () => runAction(() => startCreatingAction(gameId)),
    [gameId, runAction],
  );
  const startVoting = useCallback(
    () => runAction(() => startVotingAction(gameId)),
    [gameId, runAction],
  );
  const finish = useCallback(
    () => runAction(() => finishGameAction(gameId)),
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
    actions: { startTeamForming, startReviewing, startCreating, startVoting, finish, end },
  };
}
