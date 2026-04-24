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
  const [submitting, setSubmitting] = useState(false);
  const [skew, setSkew] = useState<number>(0); // localNow - serverNow

  const lastSeqRef = useRef<number>(-1);

  useEffect(() => {
    if (!gameId || !playerId || !playerToken) {
      return;
    }
    const unsub = liveRealtime.subscribePlayerState(
      gameId,
      playerId,
      playerToken,
      (s) => {
        if (s.seq <= lastSeqRef.current) {
          return; // stale or duplicate
        }
        lastSeqRef.current = s.seq;
        setSkew(Date.now() - s.serverNow);
        setState(s);
        setError(null);
      },
      {
        intervalMs: 2000,
        onError: (err) => {
          setError(err instanceof Error ? err.message : 'network error');
        },
      },
    );
    return unsub;
  }, [gameId, playerId, playerToken]);

  // 本地 endsAt 到了打 tick endpoint，請 server 把 phase 從 playing → locked
  // 多 client 同時打沒問題：atomic UPDATE 只 +1 seq 一次
  useEffect(() => {
    const endsAt = state?.game.questionEndsAt;
    if (!endsAt || state?.game.status !== 'playing') {
      return;
    }
    const localEndsAt = new Date(endsAt).getTime() + skew;
    const delay = Math.max(0, localEndsAt - Date.now() + 500);
    const timer = setTimeout(() => {
      void fetch(`/api/live/${gameId}/tick`, { method: 'POST' }).catch(() => {});
    }, delay);
    return () => clearTimeout(timer);
  }, [state?.game.questionEndsAt, state?.game.status, skew, gameId]);

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

  return { state, error, submit, submitting, skew };
}
