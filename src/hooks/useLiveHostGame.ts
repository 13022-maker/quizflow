'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  endGame as endGameAction,
  nextQuestion as nextQuestionAction,
  nextTeamBuzzerQuestion,
  revealTeamBuzzerAnswer,
  showResult as showResultAction,
  startGame as startGameAction,
  startTeamBuzzerGame,
} from '@/actions/liveActions';
import { liveRealtime } from '@/services/live/realtimeAdapter';
import type { LiveHostState } from '@/services/live/types';

export function useLiveHostGame(gameId: number) {
  const [state, setState] = useState<LiveHostState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // 小組搶答老師動作失敗的訊息（輪詢成功不會清掉，跟連線錯誤 error 分開）
  const [actionError, setActionError] = useState<string | null>(null);
  // 小組搶答節奏快（搶答順序、作答倒數），輪詢縮到 1 秒；classic 維持 1.5 秒
  const fastPoll = state?.game.gameMode === 'team_buzzer';

  useEffect(() => {
    const unsub = liveRealtime.subscribeHostState(
      gameId,
      (s) => {
        setState(s);
        setError(null);
      },
      {
        intervalMs: fastPoll ? 1000 : 1500,
        onError: (err) => {
          setError(err instanceof Error ? err.message : 'network error');
        },
      },
    );
    return unsub;
  }, [gameId, fastPoll]);

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

  // ── 小組搶答 ──
  const runBuzzerAction = useCallback(
    async (fn: () => Promise<{ error?: string } | { ok: true }>) => {
      setActionError(null);
      const res = await runAction(fn);
      if (res && 'error' in res && res.error) {
        setActionError(res.error);
      }
    },
    [runAction],
  );
  const startTeams = useCallback(
    (teamCount: number) => runBuzzerAction(() => startTeamBuzzerGame(gameId, teamCount)),
    [gameId, runBuzzerAction],
  );
  const buzzerReveal = useCallback(
    () => runBuzzerAction(() => revealTeamBuzzerAnswer(gameId)),
    [gameId, runBuzzerAction],
  );
  const buzzerNext = useCallback(
    () => runBuzzerAction(() => nextTeamBuzzerQuestion(gameId)),
    [gameId, runBuzzerAction],
  );

  return {
    state,
    error,
    actionError,
    pending,
    actions: { start, next, revealResult, end, startTeams, buzzerReveal, buzzerNext },
  };
}
