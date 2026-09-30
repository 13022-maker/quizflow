'use client';

import { useState } from 'react';
import QRCode from 'react-qr-code';

import { Button } from '@/components/ui/button';
import type { ReviewHostState } from '@/services/review/types';

type Props = {
  state: ReviewHostState;
  onStartTeamForming: (teamSize: number) => void;
  onEnd: () => void;
  pending: boolean;
};

const MIN_TEAM_SIZE = 2;
const MAX_TEAM_SIZE = 8;

export function ReviewHostLobby({ state, onStartTeamForming, onEnd, pending }: Props) {
  const [teamSize, setTeamSize] = useState(state.game.teamSize);
  const [joinUrl] = useState(() => {
    if (typeof window === 'undefined') {
      return '';
    }
    return `${window.location.origin}/review/join?pin=${state.game.gamePin}`;
  });

  return (
    <div className="mx-auto max-w-3xl py-16 text-center">
      <p className="text-sm text-muted-foreground">請學生掃描 QR Code，或輸入房間碼加入</p>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="flex flex-col items-center gap-4 rounded-xl border bg-card p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">房間碼</p>
          <p className="font-mono text-5xl font-bold tracking-widest">{state.game.gamePin}</p>
        </div>

        <div className="flex flex-col items-center gap-4 rounded-xl border bg-card p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">加入網址</p>
          {joinUrl && (
            <div className="rounded-lg bg-white p-3">
              <QRCode value={joinUrl} size={140} />
            </div>
          )}
          <p className="break-all text-center text-xs text-muted-foreground">{joinUrl}</p>
        </div>
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        已加入
        {' '}
        {state.joinedPlayerCount}
        {' '}
        人
      </p>

      <div className="mt-4 flex items-center justify-center gap-2">
        <label htmlFor="lobbyTeamSize" className="text-sm text-muted-foreground">每組人數</label>
        <input
          id="lobbyTeamSize"
          type="number"
          min={MIN_TEAM_SIZE}
          max={MAX_TEAM_SIZE}
          value={teamSize}
          onChange={e => setTeamSize(Number(e.target.value))}
          className="w-16 rounded-md border border-input bg-background px-2 py-1 text-center text-sm"
        />
      </div>

      <div className="mt-4 flex justify-center gap-3">
        <Button variant="outline" onClick={onEnd} disabled={pending}>
          結束活動
        </Button>
        <Button
          onClick={() => onStartTeamForming(teamSize)}
          disabled={pending || state.joinedPlayerCount === 0 || teamSize < MIN_TEAM_SIZE || teamSize > MAX_TEAM_SIZE}
        >
          開始分組
        </Button>
      </div>
    </div>
  );
}
