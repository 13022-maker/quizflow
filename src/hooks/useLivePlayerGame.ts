'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  applyBoardToPlayerState,
  isStaleBuzzerState,
  msUntilAnswerDeadline,
} from '@/services/live/buzzerBoard';
import { liveRealtime } from '@/services/live/realtimeAdapter';
import type { LiveBuzzerBoard, LivePlayerState } from '@/services/live/types';

export type SubmitResult
  = | { ok: true; isCorrect: boolean; score: number }
  | { ok: false; error: string };

export type BuzzerResult = { ok: true } | { ok: false; error: string };

export type BuzzAnswerResult
  = | { ok: true; isCorrect: boolean; delta: number }
  | { ok: false; error: string };

export function useLivePlayerGame(
  gameId: number,
  playerId: number,
  playerToken: string,
) {
  const [state, setState] = useState<LivePlayerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [, setConsecutiveFailures] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);
  // 小組搶答輪詢縮到 1 秒（搶答順序 / 作答權變化要快）；classic 維持 2 秒。
  // 用 ref 給 adapter 動態讀：原本 fastPoll 放在 effect deps，第一次拿到 state 就整個重新訂閱
  // （Ably 模式會關掉剛連好的連線再重連一次）
  const stateRef = useRef<LivePlayerState | null>(null);
  stateRef.current = state;

  const url = `/api/live/${gameId}/player-state?playerId=${playerId}&token=${encodeURIComponent(playerToken)}`;

  // 所有 state 來源（REST 輪詢 / Ably tick / Ably 看板 / buzz 回應）都經過這裡：
  // 比畫面舊的小組搶答 state 直接丟掉，避免亂序抵達時畫面倒退（例如名次閃回「還沒搶」）
  const acceptState = useCallback((s: LivePlayerState) => {
    setState(prev => (isStaleBuzzerState(prev, s) ? prev : s));
    setError(null);
    setConsecutiveFailures(0);
    setIsReconnecting(false);
  }, []);

  // 套用 server 推來的完整看板；回 'refetch' 代表看板不夠（已換題等）要打 REST
  const applyBoard = useCallback((board: LiveBuzzerBoard): 'handled' | 'refetch' => {
    const res = applyBoardToPlayerState(stateRef.current, board);
    if (res.kind === 'applied') {
      // 以函式更新：同一輪若已有更新的 state 先進來，這裡會再比一次，不會蓋掉
      setState((prev) => {
        const again = applyBoardToPlayerState(prev, board);
        return again.kind === 'applied' ? again.state : prev;
      });
      return 'handled';
    }
    return res.kind === 'ignored' ? 'handled' : 'refetch';
  }, []);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        acceptState((await res.json()) as LivePlayerState);
      }
    } catch {
      // 輪詢 / Ably 會再補上，這裡不顯示錯誤
    }
  }, [url, acceptState]);

  useEffect(() => {
    if (!gameId || !playerId || !playerToken) {
      return;
    }
    const unsub = liveRealtime.subscribePlayerState(
      gameId,
      playerId,
      playerToken,
      acceptState,
      {
        intervalMs: () => (stateRef.current?.game.gameMode === 'team_buzzer' ? 1000 : 2000),
        onBoard: applyBoard,
        onError: (err) => {
          setError(err instanceof Error ? err.message : 'network error');
          setConsecutiveFailures((c) => {
            const next = c + 1;
            if (next >= 2) {
              setIsReconnecting(true);
            }
            return next;
          });
        },
      },
    );
    return unsub;
  }, [gameId, playerId, playerToken, acceptState, applyBoard]);

  // 作答逾時是 server lazy 判定的（有人讀取才會換下一組）。Ably 模式沒有輪詢，
  // 老師端會在截止時間一到就讀一次（server 判定逾時後推看板給全場）；學生端這裡是保底
  // （例如老師分頁被關）：晚 1.2 秒 + 隨機錯開才讀，老師端先推來的看板會換掉作答組、清掉這個計時器
  const deadlineMs = msUntilAnswerDeadline(state);
  const answeringKey = state?.buzzer?.buzzes.find(b => b.result === 'answering')?.id ?? null;
  useEffect(() => {
    if (deadlineMs === null) {
      return;
    }
    const t = setTimeout(() => {
      void refetch();
    }, deadlineMs + 1200 + Math.floor(Math.random() * 600));
    return () => clearTimeout(t);
    // deadlineMs 每次 state 更新都會重算，只在「換了作答組」時重排
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answeringKey, refetch]);

  const submit = useCallback(
    async (
      questionId: number,
      selectedOptionId: string | string[],
    ): Promise<SubmitResult> => {
      setSubmitting(true);
      try {
        const res = await fetch(`/api/live/${gameId}/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerId,
            playerToken,
            questionId,
            selectedOptionId,
          }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: data.error ?? `HTTP ${res.status}` };
        }
        const data = (await res.json()) as { isCorrect: boolean; score: number };
        return { ok: true, isCorrect: data.isCorrect, score: data.score };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'network error' };
      } finally {
        setSubmitting(false);
      }
    },
    [gameId, playerId, playerToken],
  );

  // ── 小組搶答：按搶答 / 搶到後作答。錯誤訊息由 server 回繁中 ──
  // 回應會帶完整看板（board），直接套用：按的人不必等 Ably / 下一次輪詢就看到自己的名次 / 結果
  const postBuzzer = useCallback(
    async (
      path: 'buzz' | 'buzz-answer',
      payload: Record<string, unknown>,
    ): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> => {
      try {
        const res = await fetch(`/api/live/${gameId}/${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId, playerToken, ...payload }),
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          // 被拒（例如已換題、別組已答對）→ 畫面可能落後，馬上重抓
          void refetch();
          return { ok: false, error: typeof data.error === 'string' ? data.error : `HTTP ${res.status}` };
        }
        const board = data.board as LiveBuzzerBoard | null | undefined;
        if (!board || applyBoard(board) === 'refetch') {
          void refetch();
        }
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : '網路錯誤，請再試一次' };
      }
    },
    [gameId, playerId, playerToken, applyBoard, refetch],
  );
  const buzz = useCallback(
    async (questionId: number): Promise<BuzzerResult> => {
      const res = await postBuzzer('buzz', { questionId });
      return res.ok ? { ok: true } : res;
    },
    [postBuzzer],
  );
  const buzzAnswer = useCallback(
    async (questionId: number, selectedOptionId: string | string[]): Promise<BuzzAnswerResult> => {
      const res = await postBuzzer('buzz-answer', { questionId, selectedOptionId });
      if (!res.ok) {
        return res;
      }
      return { ok: true, isCorrect: res.data.isCorrect === true, delta: Number(res.data.delta ?? 0) };
    },
    [postBuzzer],
  );

  return { state, error, submit, submitting, isReconnecting, buzz, buzzAnswer };
}
