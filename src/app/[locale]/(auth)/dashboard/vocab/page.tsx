import { auth } from '@clerk/nextjs/server';
import { desc, eq, sql } from 'drizzle-orm';
import Link from 'next/link';

import { db } from '@/libs/DB';
import { vocabCardSchema, vocabSetSchema } from '@/models/Schema';

import { DeleteVocabButton } from './DeleteButton';

export const dynamic = 'force-dynamic';

export default async function VocabListPage() {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }

  // 左連接卡片表，取每個卡集中最後一張卡的建立時間（lastCardAt）
  const sets = await db
    .select({
      id: vocabSetSchema.id,
      title: vocabSetSchema.title,
      accessCode: vocabSetSchema.accessCode,
      createdAt: vocabSetSchema.createdAt,
      lastCardAt: sql<Date | null>`MAX(${vocabCardSchema.createdAt})`,
    })
    .from(vocabSetSchema)
    .leftJoin(vocabCardSchema, eq(vocabCardSchema.setId, vocabSetSchema.id))
    .where(eq(vocabSetSchema.ownerId, userId))
    .groupBy(vocabSetSchema.id)
    .orderBy(desc(vocabSetSchema.createdAt));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold">單字卡集</h1>
        <Link
          href="/dashboard/vocab/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          + AI 生成單字卡
        </Link>
      </div>

      {sets.length > 0
        ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {sets.map((set) => {
                // 最後一張卡加入的時間；若卡集無卡片，退回 set 建立時間
                const rawLastAt = set.lastCardAt ?? set.createdAt;
                const lastAt = rawLastAt instanceof Date ? rawLastAt : new Date(rawLastAt);
                const lastAtLabel = lastAt.toLocaleString('zh-TW', {
                  year: 'numeric',
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                });
                const hasCards = set.lastCardAt !== null;
                return (
                  <div key={set.id} className="rounded-xl border bg-card p-5 shadow-sm">
                    <h3 className="mb-2 text-base font-semibold">{set.title}</h3>
                    <p className="mb-4 text-xs text-muted-foreground">
                      {hasCards ? '最近加入：' : '建立於：'}
                      {lastAtLabel}
                    </p>
                    <div className="flex gap-2">
                      <Link
                        href={`/vocab/${set.accessCode}`}
                        className="flex-1 rounded-lg border px-3 py-2 text-center text-sm font-medium transition-colors hover:bg-muted"
                      >
                        預覽
                      </Link>
                      <button
                        type="button"
                        className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-100"
                        onClick={undefined}
                      >
                        複製連結
                      </button>
                      <DeleteVocabButton id={set.id} />
                    </div>
                  </div>
                );
              })}
            </div>
          )
        : (
            <div className="rounded-xl border-2 border-dashed py-16 text-center text-muted-foreground">
              <p className="mb-2 text-4xl">🔤</p>
              <p className="mb-1 font-medium">尚無單字卡集</p>
              <p className="mb-4 text-sm">使用 AI 快速生成單字卡片</p>
              <Link
                href="/dashboard/vocab/new"
                className="inline-flex rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                立即建立
              </Link>
            </div>
          )}
    </div>
  );
}
