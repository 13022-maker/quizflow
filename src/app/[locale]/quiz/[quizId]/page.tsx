import { and, asc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { QuizTaker } from '@/features/quiz/QuizTaker';
import { db } from '@/libs/DB';
import { questionSchema, quizSchema } from '@/models/Schema';

export async function generateMetadata({ params }: { params: { quizId: string } }) {
  const id = Number(params.quizId);
  if (Number.isNaN(id)) {
    return {};
  }

  const [quiz] = await db
    .select({ title: quizSchema.title })
    .from(quizSchema)
    .where(eq(quizSchema.id, id))
    .limit(1);

  return { title: quiz?.title ?? '測驗' };
}

export default async function QuizTakePage({ params }: { params: { quizId: string } }) {
  const t = await getTranslations('QuizTake');
  const quizId = Number(params.quizId);

  if (Number.isNaN(quizId)) {
    return notFound();
  }

  const [quiz] = await db
    .select()
    .from(quizSchema)
    .where(and(eq(quizSchema.id, quizId), eq(quizSchema.status, 'published')))
    .limit(1);

  if (!quiz) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-lg font-semibold">{t('not_available')}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t('not_available_description')}</p>
        </div>
      </div>
    );
  }

  const questions = await db
    .select()
    .from(questionSchema)
    .where(eq(questionSchema.quizId, quizId))
    .orderBy(asc(questionSchema.position));

  if (questions.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-lg font-semibold">{t('no_questions')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted py-10">
      <div className="mx-auto max-w-2xl px-4">
        <QuizTaker quiz={quiz} questions={questions} />
      </div>
    </div>
  );
}

export const dynamic = 'force-dynamic';
