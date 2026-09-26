import { auth } from '@clerk/nextjs/server';
import { asc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import type { ReviewSetInput } from '@/actions/reviewSetActions';
import { ReviewSetEditor } from '@/features/review/ReviewSetEditor';
import { db } from '@/libs/DB';
import { reviewSampleSchema, reviewSetSchema } from '@/models/Schema';

export default async function EditReviewSetPage({
  params,
}: {
  params: { reviewSetId: string; locale: string };
}) {
  const { userId } = await auth();
  if (!userId) {
    return notFound();
  }

  const reviewSetId = Number(params.reviewSetId);
  if (!Number.isFinite(reviewSetId) || reviewSetId <= 0) {
    return notFound();
  }

  const [reviewSet] = await db
    .select()
    .from(reviewSetSchema)
    .where(eq(reviewSetSchema.id, reviewSetId))
    .limit(1);
  if (!reviewSet || reviewSet.ownerId !== userId) {
    return notFound();
  }

  const samples = await db
    .select()
    .from(reviewSampleSchema)
    .where(eq(reviewSampleSchema.reviewSetId, reviewSetId))
    .orderBy(asc(reviewSampleSchema.orderIndex));

  const initial: ReviewSetInput = {
    title: reviewSet.title,
    topicPrompt: reviewSet.topicPrompt,
    teamSize: reviewSet.teamSize,
    reviewDurationSec: reviewSet.reviewDurationSec,
    createDurationSec: reviewSet.createDurationSec,
    samples: samples.map(s => ({
      content: s.content,
      ref: {
        correctness: s.refCorrectness,
        completeness: s.refCompleteness,
        clarity: s.refClarity,
        creativity: s.refCreativity,
      },
    })),
  };

  return <ReviewSetEditor reviewSetId={reviewSetId} initial={initial} />;
}
