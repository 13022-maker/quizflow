import { asc, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { QuizTaker } from '@/features/quiz/QuizTaker';
import { VocabTaker } from '@/features/quiz/VocabTaker';
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
    .select({
      id: quizSchema.id,
      ownerId: quizSchema.ownerId,
      title: quizSchema.title,
      description: quizSchema.description,
      accessCode: quizSchema.accessCode,
      roomCode: quizSchema.roomCode,
      status: quizSchema.status,
      showAnswers: quizSchema.showAnswers,
      shuffleQuestions: quizSchema.shuffleQuestions,
      shuffleOptions: quizSchema.shuffleOptions,
      preventLeave: quizSchema.preventLeave,
      timeLimitSeconds: quizSchema.timeLimitSeconds,
      allowedAttempts: quizSchema.allowedAttempts,
      expiresAt: quizSchema.expiresAt,
      scoringMode: quizSchema.scoringMode,
      attemptDecayRate: quizSchema.attemptDecayRate,
      quizMode: quizSchema.quizMode,
      category: quizSchema.category,
      gradeLevel: quizSchema.gradeLevel,
      tags: quizSchema.tags,
      forkCount: quizSchema.forkCount,
      forkedFromId: quizSchema.forkedFromId,
      publisherId: quizSchema.publisherId,
      isbn: quizSchema.isbn,
      chapter: quizSchema.chapter,
      bookTitle: quizSchema.bookTitle,
      visibility: quizSchema.visibility,
      slug: quizSchema.slug,
      publishedAt: quizSchema.publishedAt,
      createdAt: quizSchema.createdAt,
      updatedAt: quizSchema.updatedAt,
    })
    .from(quizSchema)
    .where(eq(quizSchema.accessCode, params.accessCode))
    .limit(1);

  if (!quiz || quiz.status !== 'published') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="rounded-xl border bg-card p-10 text-center shadow-sm">
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
        <div className="rounded-xl border bg-card p-10 text-center shadow-sm">
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
        <div className="rounded-xl border bg-card p-10 text-center shadow-sm">
          <p className="text-lg font-semibold">{t('no_questions')}</p>
        </div>
      </div>
    );
  }

  if (quiz.quizMode === 'vocab') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-50/80 via-white to-orange-50/50 pb-24 pt-10 md:py-16 md:pb-24">
        <div className="mx-auto max-w-2xl px-4">
          <VocabTaker quiz={quiz} questions={questions} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50/60 via-white to-emerald-50/30 pb-24 pt-10 md:py-16 md:pb-24">
      <div className="mx-auto max-w-2xl px-4">
        <QuizTaker quiz={quiz} questions={questions} />
      </div>
    </div>
  );
}

export const dynamic = 'force-dynamic';
