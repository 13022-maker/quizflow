'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { liveRealtime } from '@/services/live/realtimeAdapter';
import type { LivePlayerState } from '@/services/live/types';

export type SubmitResult
  = | { ok: true; isCorrect: boolean; score: number }
  | { ok: false; error: string };

export function useLivePlayerGame(
  gameId: number,
  playerId: number,
  playerToken: string,
) {
  const [state, setState] = useState<LivePlayerState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setStateRef = useRef(setState);
  const setErrorRef = useRef(setError);
  setStateRef.current = setState;
  setErrorRef.current = setError;

  useEffect(() => {
    if (!gameId || !playerId || !playerToken) {
      return;
    }
    const unsub = liveRealtime.subscribePlayerState(
      gameId,
      playerId,
      playerToken,
      (s) => {
        setStateRef.current(s);
        setErrorRef.current(null);
      },
      {
        onError: (err) => {
          setErrorRef.current(err instanceof Error ? err.message : 'network error');
        },
      },
    );
    return unsub;
  }, [gameId, playerId, playerToken]);

  // 送出動作：UI 已經 optimistic 切換，這裡只負責背景 POST。
  // 回傳 SubmitResult 讓呼叫端失敗時能 revert UI 並顯示錯誤。
  const submit = useCallback(
    async (
      questionId: number,
      selectedOptionId: string | string[],
    ): Promise<SubmitResult> => {
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
      }
    },
    [gameId, playerId, playerToken],
  );

  return { state, error, submit };
}
