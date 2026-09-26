import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { db } from '@/libs/DB';
import { reviewGameSchema, reviewSetSchema } from '@/models/Schema';

import { ReviewHostRoom } from './ReviewHostRoom';

export default async function ReviewHostPage({
  params,
}: {
  params: { gameId: string; locale: string };
}) {
  const { userId } = await auth();
  if (!userId) {
    return notFound();
  }

  const gameId = Number(params.gameId);
  if (!Number.isFinite(gameId) || gameId <= 0) {
    return notFound();
  }

  const [game] = await db
    .select({
      id: reviewGameSchema.id,
      hostUserId: reviewGameSchema.hostUserId,
      reviewSetId: reviewGameSchema.reviewSetId,
    })
    .from(reviewGameSchema)
    .where(eq(reviewGameSchema.id, gameId))
    .limit(1);

  if (!game || game.hostUserId !== userId) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-6 py-20 text-center">
        <h1 className="text-xl font-bold">找不到活動或沒有權限</h1>
        <Link href="/dashboard/review" className="text-sm text-primary hover:underline">
          ← 返回題組列表
        </Link>
      </div>
    );
  }

  const [reviewSet] = await db
    .select({ title: reviewSetSchema.title })
    .from(reviewSetSchema)
    .where(eq(reviewSetSchema.id, game.reviewSetId))
    .limit(1);

  return <ReviewHostRoom gameId={game.id} title={reviewSet?.title ?? '協作批閱'} />;
}
