import { auth } from '@clerk/nextjs/server';
import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { db } from '@/libs/DB';
import { reviewSetSchema } from '@/models/Schema';

import { StartReviewGameButton } from './StartReviewGameButton';

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
        {reviewSets.map(rs => (
          <li key={rs.id} className="flex items-center justify-between rounded-lg border p-4">
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
          </li>
        ))}
      </ul>
    </div>
  );
}
