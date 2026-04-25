'use server';

import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { questionSchema, quizSchema } from '@/models/Schema';

// 驗證測驗所有權
async function verifyOwnership(quizId: number, orgId: string) {
  const [quiz] = await db
    .select({ id: quizSchema.id, ownerId: quizSchema.ownerId })
    .from(quizSchema)
    .where(and(eq(quizSchema.id, quizId), eq(quizSchema.ownerId, orgId)))
    .limit(1);
  if (!quiz) {
    throw new Error('Quiz not found or unauthorized');
  }
  return quiz;
}

const QuestionInputSchema = z.object({
  type: z.enum(['single_choice', 'multiple_choice', 'true_false', 'short_answer', 'ranking', 'listening', 'speaking']),
  body: z.string().min(1, '請輸入題目內容'),
  imageUrl: z.string().url().optional().or(z.literal('')), // 題目圖片網址
  audioUrl: z.string().url().optional().or(z.literal('')), // 聽力題音檔網址
  audioTranscript: z.string().optional(), // 音檔逐字稿
  options: z
    .array(z.object({ id: z.string(), text: z.string().min(1, '請輸入選項內容') }))
    .optional(),
  correctAnswers: z.array(z.string()).optional(),
  points: z.coerce.number().min(1).default(1),
  difficulty: z.coerce.number().int().min(1).max(5).default(3), // 1=最簡單 5=最難（適性測驗用）
  competencyCode: z.string().max(40).optional().or(z.literal('')), // 108 新課綱學習表現代碼
});

export type QuestionInput = z.infer<typeof QuestionInputSchema>;

export async function createQuestion(quizId: number, data: QuestionInput) {
  const { orgId } = await auth();
  if (!orgId) {
    throw new Error('Unauthorized');
  }
  await verifyOwnership(quizId, orgId);

  const parsed = QuestionInputSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? '格式錯誤' };
  }

  // 取得目前最大 position
  const existing = await db
    .select({ position: questionSchema.position })
    .from(questionSchema)
    .where(eq(questionSchema.quizId, quizId));

  const nextPosition
    = existing.length > 0
      ? Math.max(...existing.map(q => q.position)) + 1
      : 1;

  await db.insert(questionSchema).values({
    quizId,
    type: parsed.data.type,
    body: parsed.data.body,
    imageUrl: parsed.data.imageUrl || null,
    audioUrl: parsed.data.audioUrl || null,
    audioTranscript: parsed.data.audioTranscript || null,
    options: parsed.data.options ?? null,
    correctAnswers: parsed.data.correctAnswers ?? null,
    points: parsed.data.points,
    position: nextPosition,
    difficulty: parsed.data.difficulty,
    competencyCode: parsed.data.competencyCode || null,
  });

  revalidatePath(`/dashboard/quizzes/${quizId}/edit`);
  return undefined;
}

export async function updateQuestion(id: number, quizId: number, data: QuestionInput) {
  const { orgId } = await auth();
  if (!orgId) {
    throw new Error('Unauthorized');
  }
  await verifyOwnership(quizId, orgId);

  const parsed = QuestionInputSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? '格式錯誤' };
  }

  await db
    .update(questionSchema)
    .set({
      type: parsed.data.type,
      body: parsed.data.body,
      imageUrl: parsed.data.imageUrl || null,
      audioUrl: parsed.data.audioUrl || null,
      audioTranscript: parsed.data.audioTranscript || null,
      options: parsed.data.options ?? null,
      correctAnswers: parsed.data.correctAnswers ?? null,
      points: parsed.data.points,
      difficulty: parsed.data.difficulty,
      competencyCode: parsed.data.competencyCode || null,
    })
    .where(eq(questionSchema.id, id));

  revalidatePath(`/dashboard/quizzes/${quizId}/edit`);
  return undefined;
}

export async function deleteQuestion(id: number, quizId: number) {
  const { orgId } = await auth();
  if (!orgId) {
    throw new Error('Unauthorized');
  }
  await verifyOwnership(quizId, orgId);

  await db.delete(questionSchema).where(eq(questionSchema.id, id));

  revalidatePath(`/dashboard/quizzes/${quizId}/edit`);
}

export async function reorderQuestions(quizId: number, orderedIds: number[]) {
  const { orgId } = await auth();
  if (!orgId) {
    throw new Error('Unauthorized');
  }
  await verifyOwnership(quizId, orgId);

  await Promise.all(
    orderedIds.map((id, index) =>
      db
        .update(questionSchema)
        .set({ position: index + 1 })
        .where(eq(questionSchema.id, id)),
    ),
  );

  revalidatePath(`/dashboard/quizzes/${quizId}/edit`);
}

// 平均分配總分 100 分到所有題目
export async function distributePoints(quizId: number) {
  const { orgId } = await auth();
  if (!orgId) {
    throw new Error('Unauthorized');
  }
  await verifyOwnership(quizId, orgId);

  // 取得所有題目 id（依 position 排序）
  const questions = await db
    .select({ id: questionSchema.id })
    .from(questionSchema)
    .where(eq(questionSchema.quizId, quizId))
    .orderBy(questionSchema.position);

  if (questions.length === 0) {
    return;
  }

  const total = 100;
  const baseScore = Math.floor(total / questions.length);
  const remainder = total - baseScore * questions.length;

  // 批次更新：餘數平均分配給前 N 題，每題 +1 分
  await Promise.all(
    questions.map((q, i) =>
      db
        .update(questionSchema)
        .set({ points: i < remainder ? baseScore + 1 : baseScore })
        .where(eq(questionSchema.id, q.id)),
    ),
  );

  revalidatePath(`/dashboard/quizzes/${quizId}/edit`);
}
