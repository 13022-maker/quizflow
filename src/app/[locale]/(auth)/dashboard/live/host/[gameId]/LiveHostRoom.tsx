'use client';

import Link from 'next/link';

import { LiveBuzzerHostScreen } from '@/features/live/LiveBuzzerHostScreen';
import { LiveHostLobby } from '@/features/live/LiveHostLobby';
import { LiveLeaderboard } from '@/features/live/LiveLeaderboard';
import { LiveQuestionScreen } from '@/features/live/LiveQuestionScreen';
import { LiveTeamLeaderboard } from '@/features/live/LiveTeamLeaderboard';
import { useLiveHostGame } from '@/hooks/useLiveHostGame';

type Props = {
  gameId: number;
  gamePin: string;
  title: string;
};

export function LiveHostRoom({ gameId, gamePin, title }: Props) {
  const { state, error, actionError, pending, actions } = useLiveHostGame(gameId);

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
  const isTeamBuzzer = state.game.gameMode === 'team_buzzer';

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

      {actionError && (
        <div className="mx-auto mt-3 max-w-3xl px-4">
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {actionError}
          </p>
        </div>
      )}

      {status === 'waiting' && (
        <LiveHostLobby
          state={state}
          onStart={actions.start}
          onEnd={actions.end}
          pending={pending}
          onStartTeams={isTeamBuzzer ? actions.startTeams : undefined}
        />
      )}

      {(status === 'playing' || status === 'showing_result') && !isTeamBuzzer && (
        <LiveQuestionScreen
          state={state}
          onRevealResult={actions.revealResult}
          onNext={actions.next}
          pending={pending}
        />
      )}

      {(status === 'playing' || status === 'showing_result') && isTeamBuzzer && (
        <LiveBuzzerHostScreen
          state={state}
          onReveal={actions.buzzerReveal}
          onNext={actions.buzzerNext}
          onEnd={actions.end}
          pending={pending}
        />
      )}

      {status === 'finished' && !isTeamBuzzer && (
        <LiveLeaderboard players={state.players} />
      )}

      {status === 'finished' && isTeamBuzzer && (
        <LiveTeamLeaderboard
          teams={state.buzzer?.teams ?? []}
          playerStats={state.buzzer?.playerStats}
        />
      )}
    </div>
  );
}
