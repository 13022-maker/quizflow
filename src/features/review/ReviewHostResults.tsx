import { Button } from '@/components/ui/button';

type Props = {
  gameId: number;
  state: import('@/services/review/types').ReviewHostState;
  onEnd: () => void;
  pending: boolean;
};

export function ReviewHostResults({ gameId, state, onEnd, pending }: Props) {
  const ranked = [...state.teams].sort((a, b) => b.score - a.score);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">排行榜</h1>
        <div className="flex items-center gap-4">
          <a href={`/api/review/${gameId}/export-csv`} className="text-sm text-primary hover:underline">
            匯出 CSV
          </a>
          {state.game.status !== 'ended' && (
            <Button variant="outline" size="sm" onClick={onEnd} disabled={pending}>
              結束活動
            </Button>
          )}
        </div>
      </div>

      <ol className="mt-6 space-y-3">
        {ranked.map((team, i) => {
          const detail = state.resultsDetail?.find(d => d.teamId === team.id);
          return (
            <li key={team.id} className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  #
                  {i + 1}
                  {' '}
                  {team.teamName}
                </span>
                <span className="text-lg font-bold">{team.score}</span>
              </div>
              {detail && (
                <div className="mt-2 text-xs text-muted-foreground">
                  <p>
                    準確度分
                    {detail.accuracyScore}
                    {' '}
                    · 速度加成
                    {detail.speedBonus}
                    {' '}
                    · 投票加成
                    {detail.voteBonus}
                    {' '}
                    （
                    {detail.votesReceived}
                    票）
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-foreground">
                    {detail.submission ?? '（未提交創作答案）'}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
