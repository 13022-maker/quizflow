'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  endGame as endGameAction,
  nextQuestion as nextQuestionAction,
  nextTeamBuzzerQuestion,
  revealTeamBuzzerAnswer,
  showResult as showResultAction,
  startGame as startGameAction,
  startTeamBuzzerGame,
} from '@/actions/liveActions';
import {
  applyBoardToHostState,
  isStaleBuzzerState,
  msUntilAnswerDeadline,
} from '@/services/live/buzzerBoard';
import { liveRealtime } from '@/services/live/realtimeAdapter';
import type { LiveBuzzerBoard, LiveHostState } from '@/services/live/types';

export function useLiveHostGame(gameId: number) {
  const [state, setState] = useState<LiveHostState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // 小組搶答老師動作失敗的訊息（輪詢成功不會清掉，跟連線錯誤 error 分開）
  const [actionError, setActionError] = useState<string | null>(null);
  // 小組搶答節奏快（搶答順序、作答倒數），輪詢縮到 1 秒；classic 維持 1.5 秒。
  // 用 ref 動態給 adapter（原本放 effect deps，第一次拿到 state 就整個重新訂閱、Ably 重連一次）
  const stateRef = useRef<LiveHostState | null>(null);
  stateRef.current = state;

  // 亂序抵達的舊小組搶答 state 直接丟掉，畫面不倒退
  const acceptState = useCallback((s: LiveHostState) => {
    setState(prev => (isStaleBuzzerState(prev, s) ? prev : s));
    setError(null);
  }, []);

  const applyBoard = useCallback((board: LiveBuzzerBoard): 'handled' | 'refetch' => {
    const res = applyBoardToHostState(stateRef.current, board);
    if (res.kind === 'applied') {
      // 以函式更新：同一輪若已有更新的 state 先進來，這裡會再比一次，不會蓋掉
      setState((prev) => {
        const again = applyBoardToHostState(prev, board);
        return again.kind === 'applied' ? again.state : prev;
      });
      return 'handled';
    }
    return res.kind === 'ignored' ? 'handled' : 'refetch';
  }, []);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/live/${gameId}/host-state`, { cache: 'no-store' });
      if (res.ok) {
        acceptState((await res.json()) as LiveHostState);
      }
    } catch {
      // 輪詢 / Ably 會再補上
    }
  }, [gameId, acceptState]);

  useEffect(() => {
    const unsub = liveRealtime.subscribeHostState(
      gameId,
      acceptState,
      {
        intervalMs: () => (stateRef.current?.game.gameMode === 'team_buzzer' ? 1000 : 1500),
        onBoard: applyBoard,
        onError: (err) => {
          setError(err instanceof Error ? err.message : 'network error');
        },
      },
    );
    return unsub;
  }, [gameId, acceptState, applyBoard]);

  // 作答逾時由 server lazy 判定：截止時間一到，老師端（投影機那台）主動讀一次 host-state，
  // server 判定逾時（−50）並交棒給下一組後，會把新看板推給全場。Ably 模式沒有輪詢，靠這個即時換組
  const deadlineMs = msUntilAnswerDeadline(state);
  const answeringKey = state?.buzzer?.buzzes.find(b => b.result === 'answering')?.id ?? null;
  useEffect(() => {
    if (deadlineMs === null) {
      return;
    }
    const t = setTimeout(() => {
      void refetch();
    }, deadlineMs + 150);
    return () => clearTimeout(t);
    // 只在「換了作答組」時重排（deadlineMs 每次 state 更新都會重算）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answeringKey, refetch]);

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
      // 動作完成立刻重抓（下一題的題目內容只有 REST 有），不用等 Ably tick / 下一次輪詢
      void refetch();
    },
    [runAction, refetch],
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
