'use client';

import { useState } from 'react';
import QRCode from 'react-qr-code';

import { Button } from '@/components/ui/button';
import type { LiveHostState } from '@/services/live/types';

type Props = {
  state: LiveHostState;
  onStart: () => void;
  onEnd: () => void;
  pending: boolean;
};

export function LiveHostLobby({ state, onStart, onEnd, pending }: Props) {
  const [joinUrl] = useState(() => {
    if (typeof window === 'undefined') {
      return '';
    }
    return `${window.location.origin}/live/join?pin=${state.game.gamePin}`;
  });
  const [copied, setCopied] = useState(false);

  const handleCopyPin = async () => {
    await navigator.clipboard.writeText(state.game.gamePin);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">
          {state.game.title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          請學生掃描 QR Code，或輸入 PIN 加入
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col items-center gap-4 rounded-xl border bg-card p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            遊戲 PIN
          </p>
          <button
            type="button"
            onClick={handleCopyPin}
            className="rounded-xl bg-primary/10 px-6 py-4 font-mono text-5xl font-bold tracking-widest text-primary transition-colors hover:bg-primary/20"
          >
            {state.game.gamePin}
          </button>
          <p className="text-xs text-muted-foreground">
            {copied ? '已複製！' : '點擊可複製'}
          </p>
        </div>

        <div className="flex flex-col items-center gap-4 rounded-xl border bg-card p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            加入網址
          </p>
          {joinUrl && (
            <div className="rounded-lg bg-white p-3">
              <QRCode value={joinUrl} size={140} />
            </div>
          )}
          <p className="break-all text-center text-xs text-muted-foreground">
            {joinUrl}
          </p>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            已加入玩家
            <span className="ml-2 text-base font-normal text-muted-foreground">
              （
              {state.players.length}
              ）
            </span>
          </h2>
        </div>
        {state.players.length === 0
          ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                等待玩家加入⋯
              </p>
            )
          : (
              <div className="flex flex-wrap gap-2">
                {state.players.map(p => (
                  <span
                    key={p.id}
                    className="rounded-full bg-muted px-3 py-1.5 text-sm"
                  >
                    {p.nickname}
                  </span>
                ))}
              </div>
            )}
      </div>

      <div className="flex justify-center gap-3">
        <Button
          size="lg"
          onClick={onStart}
          disabled={pending || state.players.length === 0}
        >
          🚀 開始遊戲
        </Button>
        <Button
          size="lg"
          variant="outline"
          onClick={onEnd}
          disabled={pending}
        >
          結束
        </Button>
      </div>
      {state.players.length === 0 && (
        <p className="text-center text-xs text-muted-foreground">
          需要至少 1 位玩家才能開始
        </p>
      )}
    </div>
  );
}
