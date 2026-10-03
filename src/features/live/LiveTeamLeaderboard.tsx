'use client';

import type { LiveBuzzerPlayerStat, LiveTeamSummary } from '@/services/live/types';

type Props = {
  teams: LiveTeamSummary[];
  highlightTeamId?: number | null;
  playerStats?: LiveBuzzerPlayerStat[]; // 老師端才傳：個人搶到 / 答對次數
};

const MEDALS = ['🥇', '🥈', '🥉'];

/** 小組搶答結束畫面：依組分排名（同分同名次），列出成員 */
export function LiveTeamLeaderboard({ teams, highlightTeamId, playerStats }: Props) {
  const sorted = [...teams].sort((a, b) => b.score - a.score || a.orderIndex - b.orderIndex);
  // 同分同名次（1、1、3）
  const ranks = sorted.map(t => sorted.findIndex(o => o.score === t.score) + 1);

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <h1 className="text-center text-3xl font-bold tracking-tight">🏆 小組排行榜</h1>

      {sorted.length === 0
        ? <p className="py-12 text-center text-sm text-muted-foreground">沒有分組資料</p>
        : (
            <ol className="space-y-2">
              {sorted.map((team, i) => {
                const rank = ranks[i]!;
                const isMine = highlightTeamId === team.id;
                return (
                  <li
                    key={team.id}
                    className={`flex items-center gap-3 rounded-xl border p-4 ${
                      rank === 1 ? 'border-yellow-300 bg-yellow-50' : 'bg-card'
                    } ${isMine ? 'ring-2 ring-primary' : ''}`}
                  >
                    <span className="w-10 shrink-0 text-center text-xl font-bold">
                      {rank <= 3 ? MEDALS[rank - 1] : `#${rank}`}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-semibold">
                        {team.name}
                        {isMine && (
                          <span className="ml-2 rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground">你的組</span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {team.members.map(m => m.nickname).join('、') || '（無成員）'}
                      </p>
                    </div>
                    <span className="font-mono text-xl font-bold">{team.score}</span>
                  </li>
                );
              })}
            </ol>
          )}

      {playerStats && playerStats.length > 0 && (
        <details className="rounded-xl border bg-card p-4">
          <summary className="cursor-pointer text-sm font-semibold">個人搶答紀錄</summary>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 font-normal">學生</th>
                <th className="py-1 font-normal">組別</th>
                <th className="py-1 text-right font-normal">搶到</th>
                <th className="py-1 text-right font-normal">答對</th>
              </tr>
            </thead>
            <tbody>
              {[...playerStats]
                .sort((a, b) => b.buzzCorrectCount - a.buzzCorrectCount || b.buzzWonCount - a.buzzWonCount)
                .map(s => (
                  <tr key={s.playerId} className="border-t">
                    <td className="py-1">{s.nickname}</td>
                    <td className="py-1 text-muted-foreground">{teams.find(t => t.id === s.teamId)?.name ?? '—'}</td>
                    <td className="py-1 text-right font-mono">{s.buzzWonCount}</td>
                    <td className="py-1 text-right font-mono">{s.buzzCorrectCount}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
