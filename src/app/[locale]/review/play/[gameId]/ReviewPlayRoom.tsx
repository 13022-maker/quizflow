'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ReviewPlayerCreate } from '@/features/review/ReviewPlayerCreate';
import { ReviewPlayerReview } from '@/features/review/ReviewPlayerReview';
import { ReviewPlayerVote } from '@/features/review/ReviewPlayerVote';
import { ReviewTeamResult } from '@/features/review/ReviewTeamResult';
import { useReviewHeartbeat } from '@/hooks/useReviewHeartbeat';
import { useReviewTeamGame } from '@/hooks/useReviewTeamGame';
import { loadPlayerSession } from '@/services/review/reviewPlayerSession';

type Props = {
  gameId: number;
};

export function ReviewPlayRoom({ gameId }: Props) {
  const router = useRouter();
  const [session, setSession] = useState<{ playerId: number; playerToken: string } | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    const saved = loadPlayerSession(gameId);
    if (!saved) {
      router.replace('/review/join');
      return;
    }
    setSession(saved);
  }, [gameId, router]);

  return hydrated && session
    ? (
        <ReviewRoomInner gameId={gameId} playerId={session.playerId} playerToken={session.playerToken} />
      )
    : (
        <div className="mx-auto max-w-md py-20 text-center">
          <p className="text-sm text-muted-foreground">載入中⋯</p>
        </div>
      );
}

function ReviewRoomInner({
  gameId,
  playerId,
  playerToken,
}: {
  gameId: number;
  playerId: number;
  playerToken: string;
}) {
  const {
    state,
    error,
    submitting,
    isReconnecting,
    submitScore,
    submitSubmission,
    submitVote,
  } = useReviewTeamGame(gameId, playerId, playerToken);

  useReviewHeartbeat(gameId, playerToken, state?.game.status !== 'ended');

  const banner = isReconnecting
    ? (
        <div className="sticky top-0 z-50 bg-red-500 px-4 py-2 text-center text-sm font-medium text-white">
          ⚠️ 網路斷線中⋯ 正在重新連線
        </div>
      )
    : null;

  if (error && !state) {
    return (
      <>
        {banner}
        <div className="mx-auto max-w-md py-20 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Link href="/review/join" className="mt-4 inline-block text-xs text-primary hover:underline">
            重新加入
          </Link>
        </div>
      </>
    );
  }

  if (!state) {
    return (
      <>
        {banner}
        <div className="mx-auto max-w-md py-20 text-center">
          <p className="text-sm text-muted-foreground">連線中⋯</p>
        </div>
      </>
    );
  }

  const { status } = state.game;

  if (status === 'lobby') {
    return (
      <>
        {banner}
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
      </>
    );
  }

  if (status === 'team_forming') {
    return (
      <>
        {banner}
        <div className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-6 text-center">
          <div className="space-y-3">
            <div className="text-4xl">👥</div>
            <h1 className="text-xl font-bold">
              你被分到「
              {state.me.teamName}
              」
            </h1>
            <p className="text-sm text-muted-foreground">
              組員：
              {state.teammates.map(t => t.nickname).join('、') || '（只有你）'}
            </p>
            <p className="text-sm text-muted-foreground">等待老師開始評分回合⋯</p>
          </div>
        </div>
      </>
    );
  }

  if (status === 'reviewing') {
    return (
      <>
        {banner}
        <ReviewPlayerReview state={state} onSubmitScore={submitScore} submitting={submitting} />
      </>
    );
  }

  if (status === 'creating') {
    return (
      <>
        {banner}
        <ReviewPlayerCreate
          topicPrompt={state.topicPrompt}
          initialContent={state.submission?.content ?? ''}
          onSave={submitSubmission}
        />
      </>
    );
  }

  if (status === 'voting') {
    return (
      <>
        {banner}
        <ReviewPlayerVote state={state} onVote={submitVote} submitting={submitting} />
      </>
    );
  }

  return (
    <>
      {banner}
      <ReviewTeamResult state={state} />
    </>
  );
}
