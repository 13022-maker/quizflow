// src/hooks/useReviewTeamGame.ts
'use client';

import { useCallback, useEffect, useState } from 'react';

import { reviewRealtime } from '@/services/review/realtimeAdapter';
import type { RubricScores } from '@/services/review/scoring';
import type { ReviewTeamState } from '@/services/review/types';

type ActionResult = { ok: true } | { ok: false; error: string };

async function postJson(url: string, body: unknown): Promise<ActionResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'network error' };
  }
}

/**
 * 學生小組 hook：透過 reviewRealtime 訂閱 team state，並提供評分／投稿／投票三個
 * 提交動作（直接打 API Route，不走 Server Action，因為需要用 playerToken 驗身分
 * 而非 Clerk auth()）。連續失敗 2 次以上視為斷線中，交給 UI 顯示重連提示。
 */
export function useReviewTeamGame(gameId: number, playerId: number, playerToken: string) {
  const [state, setState] = useState<ReviewTeamState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [, setConsecutiveFailures] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    if (!gameId || !playerId || !playerToken) {
      return;
    }
    const unsub = reviewRealtime.subscribeTeamState(
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
        intervalMs: 2000,
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
  }, [gameId, playerId, playerToken]);

  const submitScore = useCallback(
    async (sampleId: number, scores: RubricScores, comment: string | null): Promise<ActionResult> => {
      setSubmitting(true);
      try {
        return await postJson(`/api/review/${gameId}/score`, {
          playerId,
          playerToken,
          sampleId,
          ...scores,
          comment,
        });
      } finally {
        setSubmitting(false);
      }
    },
    [gameId, playerId, playerToken],
  );

  const submitSubmission = useCallback(
    async (content: string): Promise<ActionResult> => {
      setSubmitting(true);
      try {
        return await postJson(`/api/review/${gameId}/submission`, { playerId, playerToken, content });
      } finally {
        setSubmitting(false);
      }
    },
    [gameId, playerId, playerToken],
  );

  const submitVote = useCallback(
    async (votedForTeamId: number): Promise<ActionResult> => {
      setSubmitting(true);
      try {
        return await postJson(`/api/review/${gameId}/vote`, { playerId, playerToken, votedForTeamId });
      } finally {
        setSubmitting(false);
      }
    },
    [gameId, playerId, playerToken],
  );

  return { state, error, submitting, isReconnecting, submitScore, submitSubmission, submitVote };
}
