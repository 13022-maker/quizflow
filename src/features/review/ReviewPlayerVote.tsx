'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import type { ReviewTeamState } from '@/services/review/types';

type Props = {
  state: ReviewTeamState;
  onVote: (votedForTeamId: number) => Promise<{ ok: true } | { ok: false; error: string }>;
  submitting: boolean;
};

export function ReviewPlayerVote({ state, onVote, submitting }: Props) {
  const [error, setError] = useState<string | null>(null);

  if (state.hasVoted) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-lg font-bold">✅ 已投票</p>
        <p className="mt-2 text-sm text-muted-foreground">等待其他組完成投票⋯</p>
      </div>
    );
  }

  const candidates = state.votingCandidates ?? [];
  if (candidates.length === 0) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-sm text-muted-foreground">目前沒有其他組可以投票</p>
      </div>
    );
  }

  const handleVote = async (teamId: number) => {
    setError(null);
    const result = await onVote(teamId);
    if (!result.ok) {
      setError(result.error);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <h1 className="text-lg font-bold">投給你覺得最有創意的答案</h1>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {candidates.map(c => (
        <div key={c.teamId} className="space-y-2 rounded-lg border p-4">
          <p className="whitespace-pre-wrap text-sm">{c.content}</p>
          <Button size="sm" onClick={() => handleVote(c.teamId)} disabled={submitting}>
            投給這組
          </Button>
        </div>
      ))}
    </div>
  );
}
