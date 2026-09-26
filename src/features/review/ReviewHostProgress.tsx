'use client';

import { Button } from '@/components/ui/button';
import type { ReviewHostState } from '@/services/review/types';

type Props = {
  state: ReviewHostState;
  onStartReviewing: () => void;
  onStartCreating: () => void;
  onStartVoting: () => void;
  onFinish: () => void;
  pending: boolean;
};

const PHASE_LABEL: Record<string, string> = {
  team_forming: '分組完成，等待老師開始評分回合',
  reviewing: '評分回合進行中',
  creating: '共創回合進行中',
  voting: '投票回合進行中',
};

export function ReviewHostProgress({
  state,
  onStartReviewing,
  onStartCreating,
  onStartVoting,
  onFinish,
  pending,
}: Props) {
  const { status } = state.game;

  const nextButton = ({
    team_forming: { label: '開始評分回合', onClick: onStartReviewing },
    reviewing: { label: '進入共創回合', onClick: onStartCreating },
    creating: { label: '進入投票回合', onClick: onStartVoting },
    voting: { label: '結算並顯示排行榜', onClick: onFinish },
  } as Record<string, { label: string; onClick: () => void } | undefined>)[status];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-xl font-bold">{PHASE_LABEL[status] ?? status}</h1>

      <ul className="mt-6 space-y-3">
        {state.teams.map(team => (
          <li key={team.id} className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">{team.teamName}</span>
              <span className="text-xs text-muted-foreground">
                {team.memberCount}
                {' '}
                人
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              評分進度：
              {team.scoredSampleCount}
              /
              {state.totalSamples}
              {' '}
              則已有人評分，
              {team.memberReadyCount}
              /
              {team.memberCount}
              {' '}
              人全部評完
            </p>
            {(status === 'creating' || status === 'voting') && (
              <p className="mt-1 text-sm text-muted-foreground">
                共創答案：
                {team.hasSubmission ? '已提交' : '尚未提交'}
              </p>
            )}
            {status === 'voting' && (
              <p className="mt-1 text-sm text-muted-foreground">
                已收到
                {' '}
                {team.votesReceived}
                {' '}
                票
              </p>
            )}
          </li>
        ))}
      </ul>

      {nextButton && (
        <div className="mt-6 text-right">
          <Button onClick={nextButton.onClick} disabled={pending}>
            {nextButton.label}
          </Button>
        </div>
      )}
    </div>
  );
}
