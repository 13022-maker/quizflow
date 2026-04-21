'use client';

import type { LivePlayerSummary } from '@/services/live/types';

type Props = {
  players: LivePlayerSummary[];
  highlightPlayerId?: number;
};

export function LiveLeaderboard({ players, highlightPlayerId }: Props) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div className="mx-auto max-w-2xl space-y-4 py-8">
      <h1 className="text-center text-3xl font-bold tracking-tight">
        🏆 最終排行榜
      </h1>

      {sorted.length === 0
        ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              沒有玩家資料
            </p>
          )
        : (
            <div className="space-y-2">
              {sorted.map((p, i) => {
                const rank = i + 1;
                const isMe = highlightPlayerId === p.id;
                return (
                  <div
                    key={p.id}
                    className={`flex items-center gap-4 rounded-xl border p-4 transition-all ${
                      rank === 1 ? 'border-yellow-300 bg-yellow-50' : ''
                    } ${isMe ? 'ring-2 ring-primary' : ''}`}
                  >
                    <span className="w-10 text-center text-xl font-bold">
                      {rank <= 3 ? medals[rank - 1] : `#${rank}`}
                    </span>
                    <span className="flex-1 text-base font-semibold">
                      {p.nickname}
                      {isMe && (
                        <span className="ml-2 rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                          你
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      答對
                      {' '}
                      {p.correctCount}
                      {' '}
                      題
                    </span>
                    <span className="font-mono text-lg font-bold">
                      {p.score}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
    </div>
  );
}
