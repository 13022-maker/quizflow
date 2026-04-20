import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { quizSchema, vocabCardSchema, vocabSetSchema } from '@/models/Schema';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.json();
  const { quizId, title, cards } = body as {
    quizId: number;
    title: string;
    cards: Array<{ front: string; back: string; phonetic?: string; example?: string }>;
  };

  if (!cards?.length || !title) {
    return NextResponse.json({ error: '缺少卡片資料' }, { status: 400 });
  }

  const [quiz] = await db
    .select({ ownerId: quizSchema.ownerId })
    .from(quizSchema)
    .where(eq(quizSchema.id, quizId))
    .limit(1);

  if (!quiz) {
    return NextResponse.json({ error: '找不到測驗' }, { status: 404 });
  }

  const accessCode = nanoid(8);

  const [inserted] = await db.insert(vocabSetSchema).values({
    ownerId: quiz.ownerId,
    title,
    accessCode,
    status: 'published',
  }).returning();

  if (!inserted) {
    return NextResponse.json({ error: '建立失敗' }, { status: 500 });
  }

  await db.insert(vocabCardSchema).values(
    cards.map((card, i) => ({
      setId: inserted.id,
      front: card.front,
      back: card.back,
      phonetic: card.phonetic ?? null,
      example: card.example ?? null,
      position: i,
    })),
  );

  return NextResponse.json({ accessCode, id: inserted.id });
}
