'use client';

import { useCallback, useEffect, useState } from 'react';

import { liveRealtime } from '@/services/live/realtimeAdapter';
import type { LivePlayerState } from '@/services/live/types';

export type SubmitResult
  = | { ok: true; isCorrect: boolean; score: number }
  | { ok: false; error: string };

export type BuzzerResult = { ok: true } | { ok: false; error: string };

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
  // 小組搶答輪詢縮到 1 秒（搶答順序 / 作答權變化要快）；classic 維持 2 秒
  const fastPoll = state?.game.gameMode === 'team_buzzer';

  useEffect(() => {
    if (!gameId || !playerId || !playerToken) {
      return;
    }
    const unsub = liveRealtime.subscribePlayerState(
      gameId,
      playerId,
      playerToken,
      (s) => {
        setState(s);
        setError(null);
        setConsecutiveFailures(0);
        setIsReconnecting(false);
      },
      {
        intervalMs: fastPoll ? 1000 : 2000,
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
  }, [gameId, playerId, playerToken, fastPoll]);

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
  const postBuzzer = useCallback(
    async (path: 'buzz' | 'buzz-answer', payload: Record<string, unknown>): Promise<BuzzerResult> => {
      try {
        const res = await fetch(`/api/live/${gameId}/${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId, playerToken, ...payload }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: data.error ?? `HTTP ${res.status}` };
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : '網路錯誤，請再試一次' };
      }
    },
    [gameId, playerId, playerToken],
  );
  const buzz = useCallback(
    (questionId: number) => postBuzzer('buzz', { questionId }),
    [postBuzzer],
  );
  const buzzAnswer = useCallback(
    (questionId: number, selectedOptionId: string | string[]) =>
      postBuzzer('buzz-answer', { questionId, selectedOptionId }),
    [postBuzzer],
  );

  return { state, error, submit, submitting, isReconnecting, buzz, buzzAnswer };
}
