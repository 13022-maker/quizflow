import { asc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { db } from '@/libs/DB';
import { vocabCardSchema, vocabSetSchema } from '@/models/Schema';

import { SwipeableVocabPractice } from './SwipeableVocabPractice';

export const dynamic = 'force-dynamic';

export default async function VocabPublicPage({
  params,
}: {
  params: { accessCode: string };
}) {
  const { accessCode } = params;

  const [vocabSet] = await db
    .select({
      id: vocabSetSchema.id,
      title: vocabSetSchema.title,
      status: vocabSetSchema.status,
    })
    .from(vocabSetSchema)
    .where(eq(vocabSetSchema.accessCode, accessCode))
    .limit(1);

  if (!vocabSet || vocabSet.status !== 'published') {
    return notFound();
  }

  const cards = await db
    .select({
      id: vocabCardSchema.id,
      front: vocabCardSchema.front,
      back: vocabCardSchema.back,
      phonetic: vocabCardSchema.phonetic,
      example: vocabCardSchema.example,
    })
    .from(vocabCardSchema)
    .where(eq(vocabCardSchema.setId, vocabSet.id))
    .orderBy(asc(vocabCardSchema.position));

  if (cards.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50/60 to-violet-50/40 p-4">
        <div className="rounded-2xl bg-white p-8 text-center shadow-lg">
          <p className="text-4xl">📭</p>
          <p className="mt-3 font-medium">此單字卡集尚無內容</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50/60 to-violet-50/40">
      <SwipeableVocabPractice title={vocabSet.title} cards={cards} />
    </div>
  );
}
