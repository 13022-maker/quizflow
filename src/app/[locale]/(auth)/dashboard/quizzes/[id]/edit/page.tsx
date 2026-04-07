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
  if (Number.isNaN(quizId)) return {};

  const [quiz] = await db
    .select({ title: quizSchema.title })
    .from(quizSchema)
    .where(eq(quizSchema.id, quizId))
    .limit(1);

  return { title: quiz ? `編輯：${quiz.title}` : '編輯測驗' };
}

export default async function EditQuizPage({
  params,
}: {
  params: { id: string };
}) {
  const { orgId } = await auth();
  if (!orgId) return notFound();

  const quizId = Number(params.id);
  if (Number.isNaN(quizId)) return notFound();

  // 取得測驗（驗證所有權）
  const [quiz] = await db
    .select()
    .from(quizSchema)
    .where(and(eq(quizSchema.id, quizId), eq(quizSchema.ownerId, orgId)))
    .limit(1);

  if (!quiz) return notFound();

  // 取得題目，依 position 排序
  const questions = await db
    .select()
    .from(questionSchema)
    .where(eq(questionSchema.quizId, quizId))
    .orderBy(asc(questionSchema.position));

  // 判斷是否為 Pro 方案（決定 AI 出題功能是否可用）
  const isPro = await isProOrAbove(orgId);

  return <QuizEditor quiz={quiz} questions={questions} isPro={isPro} />;
}

export const dynamic = 'force-dynamic';
