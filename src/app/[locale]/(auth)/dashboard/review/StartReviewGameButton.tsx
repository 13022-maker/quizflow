'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createReviewGame } from '@/actions/reviewActions';
import { Button } from '@/components/ui/button';

export function StartReviewGameButton({ reviewSetId }: { reviewSetId: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setPending(true);
    setError(null);
    const result = await createReviewGame(reviewSetId);
    setPending(false);
    if ('error' in result && result.error) {
      setError(result.error);
      return;
    }
    router.push(`/dashboard/review/host/${result.gameId}`);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={handleClick} disabled={pending}>
        {pending ? '建立中⋯' : '開始直播'}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
