'use server';

import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { db } from '@/libs/DB';
import { vocabCardSchema, vocabSetSchema } from '@/models/Schema';

type CardInput = {
  front: string;
  back: string;
  phonetic?: string;
  example?: string;
};

export async function createVocabSet(data: { title: string; cards: CardInput[] }) {
  const { orgId } = await auth();
  if (!orgId) throw new Error('Unauthorized');

  const accessCode = nanoid(8);

  const [inserted] = await db.insert(vocabSetSchema).values({
    ownerId: orgId,
    title: data.title,
    accessCode,
    status: 'published',
  }).returning({ id: vocabSetSchema.id });

  if (!inserted) throw new Error('建立失敗');

  if (data.cards.length > 0) {
    await db.insert(vocabCardSchema).values(
      data.cards.map((card, i) => ({
        setId: inserted.id,
        front: card.front,
        back: card.back,
        phonetic: card.phonetic ?? null,
        example: card.example ?? null,
        position: i,
      })),
    );
  }

  revalidatePath('/dashboard/vocab');
  redirect(`/dashboard/vocab`);
}

export async function deleteVocabSet(id: number) {
  const { orgId } = await auth();
  if (!orgId) throw new Error('Unauthorized');

  await db.delete(vocabSetSchema).where(
    and(eq(vocabSetSchema.id, id), eq(vocabSetSchema.ownerId, orgId)),
  );

  revalidatePath('/dashboard/vocab');
}
