'use client';

import { Button } from '@/components/ui/button';
import type { ReviewHostState } from '@/services/review/types';

type Props = {
  state: ReviewHostState;
  onStartTeamForming: () => void;
  onEnd: () => void;
  pending: boolean;
};

export function ReviewHostLobby({ state, onStartTeamForming, onEnd, pending }: Props) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="text-sm text-muted-foreground">房間碼</p>
      <p className="font-mono text-5xl font-bold tracking-widest">{state.game.gamePin}</p>
      <p className="mt-6 text-sm text-muted-foreground">
        已加入
        {' '}
        {state.joinedPlayerCount}
        {' '}
        人
      </p>
      <div className="mt-8 flex justify-center gap-3">
        <Button variant="outline" onClick={onEnd} disabled={pending}>
          結束活動
        </Button>
        <Button onClick={onStartTeamForming} disabled={pending || state.joinedPlayerCount === 0}>
          開始分組
        </Button>
      </div>
    </div>
  );
}
