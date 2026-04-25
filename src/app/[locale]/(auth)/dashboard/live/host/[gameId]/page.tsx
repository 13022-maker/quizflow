import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { db } from '@/libs/DB';
import { liveGameSchema } from '@/models/Schema';

import { LiveHostRoom } from './LiveHostRoom';

export default async function LiveHostPage({
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
      id: liveGameSchema.id,
      hostUserId: liveGameSchema.hostUserId,
      title: liveGameSchema.title,
      gamePin: liveGameSchema.gamePin,
    })
    .from(liveGameSchema)
    .where(eq(liveGameSchema.id, gameId))
    .limit(1);

  if (!game || game.hostUserId !== userId) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-6 py-20 text-center">
        <h1 className="text-xl font-bold">找不到直播或沒有權限</h1>
        <Link
          href="/dashboard/quizzes"
          className="text-sm text-primary hover:underline"
        >
          ← 返回測驗列表
        </Link>
      </div>
    );
  }

  return <LiveHostRoom gameId={game.id} gamePin={game.gamePin} title={game.title} />;
}
