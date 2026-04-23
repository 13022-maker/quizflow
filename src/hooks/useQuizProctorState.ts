// 老師監考牆 / 儀表板 state 訂閱 hook
// 模式與 useLiveHostGame 同：初始 REST fetch + 訂閱 Ably tick → 重 fetch
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type ProctorStudent = {
  responseId: number;
  tokenPrefix: string;
  nickname: string;
  status: 'in_progress' | 'submitted';
  lastAnsweredQuestionIndex: number;
  leaveCount: number;
  startedAt: string;
  submittedAt: string | null;
  scorePercent: number | null;
};

export type ProctorQuestionStat = {
  questionId: number;
  position: number;
  body: string;
  type: string;
  totalAnswered: number;
  totalCorrect: number;
  correctRate: number | null;
};

export type ProctorState = {
  quiz: { id: number; title: string; totalQuestions: number };
  aggregate: {
    totalCount: number;
    inProgressCount: number;
    submittedCount: number;
    avgScorePercent: number | null;
  };
  students: ProctorStudent[];
  perQuestionStats: ProctorQuestionStat[];
  hardQuestions: ProctorQuestionStat[];
};

export function useQuizProctorState(quizId: number) {
  const [state, setState] = useState<ProctorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warningInFlight, setWarningInFlight] = useState(false);
  const cancelledRef = useRef(false);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/quiz/${quizId}/proctor-state`, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as ProctorState;
      if (!cancelledRef.current) {
        setState(data);
        setError(null);
      }
    } catch (err) {
      if (!cancelledRef.current) {
        setError(err instanceof Error ? err.message : '載入失敗');
      }
    }
  }, [quizId]);

  useEffect(() => {
    cancelledRef.current = false;
    void fetchState();

    // Ably subscribe（若啟用）；未啟用則 fallback 到 polling 每 3 秒
    let cleanup = () => {};
    const flag = process.env.NEXT_PUBLIC_LIVE_REALTIME;

    if (flag === 'ably') {
      let closed = false;
      import('ably').then(({ default: Ably }) => {
        if (closed) {
          return;
        }
        const realtime = new Ably.Realtime({
          authUrl: `/api/quiz/${quizId}/ably-auth`,
          authParams: { role: 'host' },
          authMethod: 'GET',
        });
        const channel = realtime.channels.get(`quiz-proctor:${quizId}`);
        channel.subscribe('tick', () => {
          void fetchState();
        });
        cleanup = () => {
          closed = true;
          realtime.close();
        };
      }).catch(() => {
        // Ably 載入失敗退回 polling
      });
    } else {
      const timer = setInterval(() => {
        void fetchState();
      }, 3000);
      cleanup = () => clearInterval(timer);
    }

    return () => {
      cancelledRef.current = true;
      cleanup();
    };
  }, [quizId, fetchState]);

  const warnStudent = useCallback(
    async (responseId: number, message?: string) => {
      if (warningInFlight) {
        return;
      }
      setWarningInFlight(true);
      try {
        await fetch(`/api/quiz/${quizId}/warn-student`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ responseId, message }),
        });
      } finally {
        setWarningInFlight(false);
      }
    },
    [quizId, warningInFlight],
  );

  return { state, error, warnStudent, warningInFlight, refetch: fetchState };
}
