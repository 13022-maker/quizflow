'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { LiveLeaderboard } from '@/features/live/LiveLeaderboard';
import { LivePlayerQuestion } from '@/features/live/LivePlayerQuestion';
import { useLivePlayerGame } from '@/hooks/useLivePlayerGame';
import { loadPlayerSession } from '@/services/live/playerSession';

type Props = {
  gameId: number;
};

export function LivePlayRoom({ gameId }: Props) {
  const router = useRouter();
  const [session, setSession]
    = useState<{ playerId: number; playerToken: string } | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    const saved = loadPlayerSession(gameId);
    if (!saved) {
      router.replace('/live/join');
      return;
    }
    setSession(saved);
  }, [gameId, router]);

  // 在拿到 session 前不要訂閱（避免用 0 打 API）
  return hydrated && session
    ? (
        <LiveRoomInner
          gameId={gameId}
          playerId={session.playerId}
          playerToken={session.playerToken}
        />
      )
    : (
        <div className="mx-auto max-w-md py-20 text-center">
          <p className="text-sm text-muted-foreground">載入中⋯</p>
        </div>
      );
}

function LiveRoomInner({
  gameId,
  playerId,
  playerToken,
}: {
  gameId: number;
  playerId: number;
  playerToken: string;
}) {
  const { state, error, submit, submitting } = useLivePlayerGame(
    gameId,
    playerId,
    playerToken,
  );

  if (error && !state) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Link href="/live/join" className="mt-4 inline-block text-xs text-primary hover:underline">
          重新加入
        </Link>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <p className="text-sm text-muted-foreground">連線中⋯</p>
      </div>
    );
  }

  const { status } = state.game;

  if (status === 'waiting') {
    return (
      <div className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-6 text-center">
        <div className="space-y-3">
          <div className="text-4xl">⏳</div>
          <h1 className="text-xl font-bold">等待老師開始⋯</h1>
          <p className="text-sm text-muted-foreground">
            你的暱稱：
            <strong>{state.me.nickname}</strong>
          </p>
        </div>
      </div>
    );
  }

  if (status === 'finished') {
    return (
      <LiveLeaderboard
        players={state.leaderboard}
        highlightPlayerId={state.me.id}
      />
    );
  }

  return (
    <LivePlayerQuestion
      state={state}
      onSubmit={async (questionId, sel) => {
        await submit(questionId, sel);
      }}
      submitting={submitting}
    />
  );
}
