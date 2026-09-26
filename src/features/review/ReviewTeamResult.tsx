import type { ReviewTeamState } from '@/services/review/types';

export function ReviewTeamResult({ state }: { state: ReviewTeamState }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="text-4xl">🏆</p>
      <h1 className="mt-4 text-xl font-bold">{state.me.teamName}</h1>
      {state.finalTeamRank && (
        <>
          <p className="mt-2 text-3xl font-bold">
            第
            {state.finalTeamRank.rank}
            名
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {state.finalTeamRank.score}
            {' '}
            分
          </p>
        </>
      )}
    </div>
  );
}
