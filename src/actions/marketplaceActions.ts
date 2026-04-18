'use server';

import { auth } from '@clerk/nextjs/server';
import { and, count, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { questionSchema, quizSchema } from '@/models/Schema';

const PublishSchema = z.object({
  quizId: z.number(),
  category: z.string().min(1),
  gradeLevel: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

export async function publishToMarketplace(data: z.infer<typeof PublishSchema>) {
  const { orgId } = await auth();
  if (!orgId) throw new Error('未登入');

  const parsed = PublishSchema.safeParse(data);
  if (!parsed.success) return { error: '請填寫完整資訊' };

  const [quiz] = await db
    .select({ id: quizSchema.id, status: quizSchema.status, ownerId: quizSchema.ownerId })
    .from(quizSchema)
    .where(and(eq(quizSchema.id, parsed.data.quizId), eq(quizSchema.ownerId, orgId)))
    .limit(1);

  if (!quiz) return { error: '找不到測驗或無權限' };
  if (quiz.status !== 'published') return { error: '請先發佈測驗再分享到市集' };

  const [qCount] = await db
    .select({ total: count() })
    .from(questionSchema)
    .where(eq(questionSchema.quizId, parsed.data.quizId));

  if (!qCount?.total) return { error: '測驗沒有題目，無法分享' };

  await db
    .update(quizSchema)
    .set({
      isMarketplace: true,
      category: parsed.data.category,
      gradeLevel: parsed.data.gradeLevel,
      tags: parsed.data.tags,
    })
    .where(eq(quizSchema.id, parsed.data.quizId));

  revalidatePath('/marketplace');
  revalidatePath(`/dashboard/quizzes/${parsed.data.quizId}/edit`);
  return { success: true };
}

export async function unpublishFromMarketplace(quizId: number) {
  const { orgId } = await auth();
  if (!orgId) throw new Error('未登入');

  await db
    .update(quizSchema)
    .set({ isMarketplace: false })
    .where(and(eq(quizSchema.id, quizId), eq(quizSchema.ownerId, orgId)));

  revalidatePath('/marketplace');
  revalidatePath(`/dashboard/quizzes/${quizId}/edit`);
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function copyQuizFromMarketplace(sourceQuizId: number) {
  const { orgId } = await auth();
  if (!orgId) throw new Error('請先登入再複製');

  const [source] = await db
    .select()
    .from(quizSchema)
    .where(and(eq(quizSchema.id, sourceQuizId), eq(quizSchema.isMarketplace, true)))
    .limit(1);

  if (!source) return { error: '找不到此市集測驗' };

  const questions = await db
    .select()
    .from(questionSchema)
    .where(eq(questionSchema.quizId, sourceQuizId))
    .orderBy(questionSchema.position);

  const [newQuiz] = await db
    .insert(quizSchema)
    .values({
      ownerId: orgId,
      title: `${source.title}（複製）`,
      description: source.description,
      accessCode: nanoid(8),
      roomCode: generateRoomCode(),
      status: 'draft',
      category: source.category,
      gradeLevel: source.gradeLevel,
      tags: source.tags,
      originalQuizId: sourceQuizId,
    })
    .returning({ id: quizSchema.id });

  if (!newQuiz) return { error: '複製失敗' };

  if (questions.length > 0) {
    await db.insert(questionSchema).values(
      questions.map((q, i) => ({
        quizId: newQuiz.id,
        type: q.type,
        body: q.body,
        imageUrl: q.imageUrl,
        audioUrl: q.audioUrl,
        audioTranscript: q.audioTranscript,
        options: q.options,
        correctAnswers: q.correctAnswers,
        points: q.points,
        position: i + 1,
      })),
    );
  }

  await db
    .update(quizSchema)
    .set({ copyCount: sql`${quizSchema.copyCount} + 1` })
    .where(eq(quizSchema.id, sourceQuizId));

  revalidatePath('/marketplace');
  revalidatePath('/dashboard/quizzes');
  return { success: true, newQuizId: newQuiz.id };
}
