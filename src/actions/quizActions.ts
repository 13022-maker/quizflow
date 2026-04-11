'use server';

import { auth } from '@clerk/nextjs/server';
import { and, count, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getOrgPlanId } from '@/libs/Plan';
import { quizSchema } from '@/models/Schema';
import { PricingPlanList } from '@/utils/AppConfig';

const CreateQuizSchema = z.object({
  title: z.string().min(1, '請輸入測驗標題').max(200),
  description: z.string().max(500).optional(),
});

export type CreateQuizInput = z.infer<typeof CreateQuizSchema>;

export async function createQuiz(data: CreateQuizInput) {
  const { orgId } = await auth();
  if (!orgId) {
    throw new Error('Unauthorized');
  }

  const parsed = CreateQuizSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? '資料格式錯誤' };
  }

  // 檢查免費方案測驗數量上限（999 代表無限制，即 Pro/Enterprise）
  const planId = await getOrgPlanId(orgId);
  const quizLimit = PricingPlanList[planId]?.features.website ?? 10;
  if (quizLimit < 999) {
    const [row] = await db
      .select({ total: count() })
      .from(quizSchema)
      .where(eq(quizSchema.ownerId, orgId));
    if ((row?.total ?? 0) >= quizLimit) {
      return { error: 'QUOTA_EXCEEDED' };
    }
  }

  await db.insert(quizSchema).values({
    ownerId: orgId,
    title: parsed.data.title,
    description: parsed.data.description,
    accessCode: nanoid(8), // 8 碼隨機英數字，作為學生作答連結
  });

  redirect('/dashboard/quizzes');
}

export async function updateQuiz(
  id: number,
  data: { title: string; description?: string; status: 'draft' | 'published' | 'closed' },
) {
  const { orgId } = await auth();
  if (!orgId) {
    throw new Error('Unauthorized');
  }

  await db
    .update(quizSchema)
    .set({ title: data.title, description: data.description, status: data.status })
    .where(and(eq(quizSchema.id, id), eq(quizSchema.ownerId, orgId)));

  revalidatePath(`/dashboard/quizzes/${id}/edit`);
  revalidatePath('/dashboard/quizzes');
}

// 更新測驗的防作弊與顯示設定
export async function updateQuizSettings(
  id: number,
  data: {
    shuffleQuestions?: boolean;
    shuffleOptions?: boolean;
    allowedAttempts?: number | null;
    showAnswers?: boolean;
    timeLimitSeconds?: number | null;
    preventLeave?: boolean;
  },
) {
  const { orgId } = await auth();
  if (!orgId) {
    throw new Error('Unauthorized');
  }

  await db
    .update(quizSchema)
    .set(data)
    .where(and(eq(quizSchema.id, id), eq(quizSchema.ownerId, orgId)));

  revalidatePath(`/dashboard/quizzes/${id}/edit`);
}

export async function deleteQuiz(id: number) {
  const { orgId } = await auth();
  if (!orgId) {
    throw new Error('Unauthorized');
  }

  await db
    .delete(quizSchema)
    .where(and(eq(quizSchema.id, id), eq(quizSchema.ownerId, orgId)));

  revalidatePath('/dashboard/quizzes');
}
