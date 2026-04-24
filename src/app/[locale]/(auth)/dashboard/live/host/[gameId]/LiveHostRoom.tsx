'use client';

import Link from 'next/link';

import { LiveHostLobby } from '@/features/live/LiveHostLobby';
import { LiveLeaderboard } from '@/features/live/LiveLeaderboard';
import { LiveQuestionScreen } from '@/features/live/LiveQuestionScreen';
import { useLiveHostGame } from '@/hooks/useLiveHostGame';

type Props = {
  gameId: number;
  gamePin: string;
  title: string;
};

export function LiveHostRoom({ gameId, gamePin, title }: Props) {
  const { state, error, pending, skew, actions } = useLiveHostGame(gameId);

  if (error && !state) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <p className="text-sm text-muted-foreground">
          載入中⋯（PIN：
          {gamePin}
          ）
        </p>
      </div>
    );
  }

  const { status } = state.game;

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl px-4 pt-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <Link href="/dashboard/quizzes" className="hover:text-foreground">
            ← 返回
          </Link>
          <span className="truncate">{title}</span>
        </div>
      </div>

      {status === 'waiting' && (
        <LiveHostLobby
          state={state}
          onStart={actions.start}
          onEnd={actions.end}
          pending={pending}
        />
      )}

      {(status === 'playing' || status === 'locked' || status === 'showing_result') && (
        <LiveQuestionScreen
          state={state}
          skew={skew}
          onRevealResult={actions.revealResult}
          onNext={actions.next}
          pending={pending}
        />
      )}

      {status === 'finished' && (
        <LiveLeaderboard players={state.players} />
      )}
    </div>
  );
}
