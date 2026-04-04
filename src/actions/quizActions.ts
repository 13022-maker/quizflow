'use server';

import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { quizSchema } from '@/models/Schema';

const CreateQuizSchema = z.object({
  title: z.string().min(1, '請輸入測驗標題').max(200),
  description: z.string().max(500).optional(),
});

export type CreateQuizInput = z.infer<typeof CreateQuizSchema>;

export async function createQuiz(data: CreateQuizInput) {
  const { orgId } = await auth();
  if (!orgId) throw new Error('Unauthorized');

  const parsed = CreateQuizSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? '資料格式錯誤' };
  }

  await db.insert(quizSchema).values({
    ownerId: orgId,
    title: parsed.data.title,
    description: parsed.data.description,
  });

  redirect('/dashboard/quizzes');
}

export async function updateQuiz(
  id: number,
  data: { title: string; description?: string; status: 'draft' | 'published' | 'closed' },
) {
  const { orgId } = await auth();
  if (!orgId) throw new Error('Unauthorized');

  await db
    .update(quizSchema)
    .set({ title: data.title, description: data.description, status: data.status })
    .where(and(eq(quizSchema.id, id), eq(quizSchema.ownerId, orgId)));

  revalidatePath(`/dashboard/quizzes/${id}/edit`);
  revalidatePath('/dashboard/quizzes');
}

export async function deleteQuiz(id: number) {
  const { orgId } = await auth();
  if (!orgId) throw new Error('Unauthorized');

  await db
    .delete(quizSchema)
    .where(and(eq(quizSchema.id, id), eq(quizSchema.ownerId, orgId)));

  revalidatePath('/dashboard/quizzes');
}
