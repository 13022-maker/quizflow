import { asc, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { QuizTaker } from '@/features/quiz/QuizTaker';
import { db } from '@/libs/DB';
import { questionSchema, quizSchema } from '@/models/Schema';

export async function generateMetadata({ params }: { params: { accessCode: string } }) {
  const [quiz] = await db
    .select({ title: quizSchema.title })
    .from(quizSchema)
    .where(eq(quizSchema.accessCode, params.accessCode))
    .limit(1);

  return { title: quiz?.title ?? '測驗' };
}

export default async function QuizTakePage({ params }: { params: { accessCode: string } }) {
  const t = await getTranslations('QuizTake');

  // 依 accessCode 查詢測驗（只顯示已發佈的）
  const [quiz] = await db
    .select()
    .from(quizSchema)
    .where(eq(quizSchema.accessCode, params.accessCode))
    .limit(1);

  if (!quiz || quiz.status !== 'published') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-lg font-semibold">{t('not_available')}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t('not_available_description')}</p>
        </div>
      </div>
    );
  }

  // 到期時間檢查
  if (quiz.expiresAt && new Date() > quiz.expiresAt) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-lg font-semibold">此測驗已結束</p>
          <p className="mt-2 text-sm text-muted-foreground">測驗連結已過期，無法作答。</p>
        </div>
      </div>
    );
  }

  const questions = await db
    .select()
    .from(questionSchema)
    .where(eq(questionSchema.quizId, quiz.id))
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
