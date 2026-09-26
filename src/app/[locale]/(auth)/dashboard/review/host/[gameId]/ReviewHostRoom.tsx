'use client';

import Link from 'next/link';

import { ReviewHostLobby } from '@/features/review/ReviewHostLobby';
import { ReviewHostProgress } from '@/features/review/ReviewHostProgress';
import { ReviewHostResults } from '@/features/review/ReviewHostResults';
import { useReviewHostGame } from '@/hooks/useReviewHostGame';

type Props = {
  gameId: number;
  title: string;
};

export function ReviewHostRoom({ gameId, title }: Props) {
  const { state, error, pending, actions } = useReviewHostGame(gameId);

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
        <p className="text-sm text-muted-foreground">載入中⋯</p>
      </div>
    );
  }

  const { status } = state.game;

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl px-4 pt-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <Link href="/dashboard/review" className="hover:text-foreground">← 返回</Link>
          <span className="truncate">{title}</span>
        </div>
      </div>

      {status === 'lobby' && (
        <ReviewHostLobby
          state={state}
          onStartTeamForming={actions.startTeamForming}
          onEnd={actions.end}
          pending={pending}
        />
      )}

      {(status === 'team_forming' || status === 'reviewing' || status === 'creating' || status === 'voting') && (
        <ReviewHostProgress
          state={state}
          onStartReviewing={actions.startReviewing}
          onStartCreating={actions.startCreating}
          onStartVoting={actions.startVoting}
          onFinish={actions.finish}
          pending={pending}
        />
      )}

      {(status === 'results' || status === 'ended') && (
        <ReviewHostResults gameId={gameId} state={state} onEnd={actions.end} pending={pending} />
      )}
    </div>
  );
}
