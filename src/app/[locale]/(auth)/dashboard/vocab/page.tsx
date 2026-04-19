import { auth } from '@clerk/nextjs/server';
import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';

import { db } from '@/libs/DB';
import { vocabCardSchema, vocabSetSchema } from '@/models/Schema';

import { DeleteVocabButton } from './DeleteButton';

export const dynamic = 'force-dynamic';

export default async function VocabListPage() {
  const { orgId } = await auth();
  if (!orgId) return null;

  const sets = await db
    .select({
      id: vocabSetSchema.id,
      title: vocabSetSchema.title,
      accessCode: vocabSetSchema.accessCode,
      createdAt: vocabSetSchema.createdAt,
    })
    .from(vocabSetSchema)
    .where(eq(vocabSetSchema.ownerId, orgId))
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
              {sets.map(set => (
                <div key={set.id} className="rounded-xl border bg-card p-5 shadow-sm">
                  <h3 className="mb-2 text-base font-semibold">{set.title}</h3>
                  <p className="mb-4 text-xs text-muted-foreground">
                    {set.createdAt.toLocaleDateString('zh-TW')}
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
              ))}
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
