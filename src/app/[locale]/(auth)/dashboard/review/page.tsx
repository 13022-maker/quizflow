import { auth } from '@clerk/nextjs/server';
import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { db } from '@/libs/DB';
import { reviewSetSchema } from '@/models/Schema';
import { getGameHistory } from '@/services/review/reviewStore';

import { StartReviewGameButton } from './StartReviewGameButton';

const GAME_STATUS_LABEL: Record<string, string> = {
  lobby: '等待加入中',
  team_forming: '分組中',
  reviewing: '評分中',
  creating: '共創中',
  voting: '投票中',
  results: '已結算',
  ended: '已結束',
};

export default async function ReviewSetListPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect('/sign-in');
  }

  const reviewSets = await db
    .select()
    .from(reviewSetSchema)
    .where(eq(reviewSetSchema.ownerId, userId))
    .orderBy(desc(reviewSetSchema.createdAt));

  const histories = await Promise.all(
    reviewSets.map(rs => getGameHistory(rs.id, userId)),
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">小組協作批閱創作題</h1>
        <Button asChild>
          <Link href="/dashboard/review/new">建立新題組</Link>
        </Button>
      </div>

      {reviewSets.length === 0 && (
        <p className="mt-8 text-sm text-muted-foreground">還沒有任何題組，建立第一份吧！</p>
      )}

      <ul className="mt-6 space-y-3">
        {reviewSets.map((rs, i) => (
          <li key={rs.id} className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{rs.title}</p>
                <p className="text-xs text-muted-foreground">
                  每組
                  {rs.teamSize}
                  人
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" asChild>
                  <Link href={`/dashboard/review/${rs.id}/edit`}>編輯</Link>
                </Button>
                <StartReviewGameButton reviewSetId={rs.id} />
              </div>
            </div>

            {histories[i]!.length > 0 && (
              <div className="mt-3 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground">歷史場次</p>
                <ul className="mt-2 space-y-1">
                  {histories[i]!.map(game => (
                    <li key={game.id} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {new Date(game.createdAt).toLocaleString('zh-TW')}
                        {' · '}
                        {GAME_STATUS_LABEL[game.status] ?? game.status}
                      </span>
                      <Link href={`/dashboard/review/host/${game.id}`} className="text-primary hover:underline">
                        查看
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
