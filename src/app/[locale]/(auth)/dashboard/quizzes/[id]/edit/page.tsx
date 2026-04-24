import { auth } from '@clerk/nextjs/server';
import { and, asc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { QuizEditor } from '@/features/quiz/QuizEditor';
import { db } from '@/libs/DB';
import { isProOrAbove } from '@/libs/Plan';
import { questionSchema, quizSchema } from '@/models/Schema';

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}) {
  const quizId = Number(params.id);
  if (Number.isNaN(quizId)) {
    return {};
  }

  const [quiz] = await db
    .select({ title: quizSchema.title })
    .from(quizSchema)
    .where(eq(quizSchema.id, quizId))
    .limit(1);

  return { title: quiz ? `編輯：${quiz.title}` : '編輯測驗' };
}

export default async function EditQuizPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { ai?: string };
}) {
  const { orgId } = await auth();
  if (!orgId) {
    return notFound();
  }

  const quizId = Number(params.id);
  if (Number.isNaN(quizId)) {
    return notFound();
  }

  // 取得測驗（驗證所有權）
  // 明確列出欄位，避免 SELECT * 撈到尚未 migrate 的欄位導致 crash
  const [quiz] = await db
    .select({
      id: quizSchema.id,
      ownerId: quizSchema.ownerId,
      title: quizSchema.title,
      description: quizSchema.description,
      accessCode: quizSchema.accessCode,
      status: quizSchema.status,
      shuffleQuestions: quizSchema.shuffleQuestions,
      shuffleOptions: quizSchema.shuffleOptions,
      allowedAttempts: quizSchema.allowedAttempts,
      showAnswers: quizSchema.showAnswers,
      timeLimitSeconds: quizSchema.timeLimitSeconds,
      preventLeave: quizSchema.preventLeave,
      roomCode: quizSchema.roomCode,
      scoringMode: quizSchema.scoringMode,
      attemptDecayRate: quizSchema.attemptDecayRate,
      expiresAt: quizSchema.expiresAt,
      isMarketplace: quizSchema.isMarketplace,
      category: quizSchema.category,
      gradeLevel: quizSchema.gradeLevel,
      tags: quizSchema.tags,
      copyCount: quizSchema.copyCount,
      originalQuizId: quizSchema.originalQuizId,
      adaptiveMode: quizSchema.adaptiveMode,
      adaptiveTargetCount: quizSchema.adaptiveTargetCount,
      updatedAt: quizSchema.updatedAt,
      createdAt: quizSchema.createdAt,
    })
    .from(quizSchema)
    .where(and(eq(quizSchema.id, quizId), eq(quizSchema.ownerId, orgId)))
    .limit(1);

  if (!quiz) {
    return notFound();
  }

  // 取得題目，依 position 排序
  const questions = await db
    .select()
    .from(questionSchema)
    .where(eq(questionSchema.quizId, quizId))
    .orderBy(asc(questionSchema.position));

  // 判斷是否為 Pro 方案（決定 AI 出題功能是否可用）
  const isPro = await isProOrAbove(orgId);

  const autoOpenAI = searchParams.ai === '1';

  return <QuizEditor quiz={quiz as any} questions={questions} isPro={isPro} autoOpenAI={autoOpenAI} />;
}

export const dynamic = 'force-dynamic';
