import { asc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { QuizTaker } from '@/features/quiz/QuizTaker';
import { VocabTaker } from '@/features/quiz/VocabTaker';
import { db } from '@/libs/DB';
import { questionSchema, quizSchema } from '@/models/Schema';
import { getBaseUrl } from '@/utils/Helpers';

/**
 * 公開測驗友善 URL — 由 visibility=unlisted/public 的 quiz 自動產生 slug
 *
 * 設計決定（Phase 1 commit 3）:
 * - Q2: private 即使 slug 存在也回 404（避免私有被人猜中 slug 直接打開）
 * - Q3: slug 找不到 → 404
 * - Q4: 跟既有 /quiz/[accessCode] 並存（向後相容,已分享出去的舊 URL 不會 break）
 */

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const [quiz] = await db
    .select({
      title: quizSchema.title,
      description: quizSchema.description,
      visibility: quizSchema.visibility,
      publishedAt: quizSchema.publishedAt,
      updatedAt: quizSchema.updatedAt,
      tags: quizSchema.tags,
    })
    .from(quizSchema)
    .where(eq(quizSchema.slug, params.slug))
    .limit(1);

  // private 不漏元資料,直接 fallback
  if (!quiz || quiz.visibility === 'private') {
    return { title: '測驗不存在' };
  }

  const url = `${getBaseUrl()}/q/${params.slug}`;
  const title = quiz.title;
  const description = quiz.description ?? `${quiz.title} — 來自 QuizFlow 老師社群`;

  return {
    title,
    description,
    alternates: { canonical: `/q/${params.slug}` },
    openGraph: {
      type: 'article',
      url,
      title,
      description,
      publishedTime: quiz.publishedAt?.toISOString(),
      modifiedTime: quiz.updatedAt?.toISOString(),
      tags: quiz.tags ?? undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default async function QuizBySlugPage({ params }: { params: { slug: string } }) {
  const t = await getTranslations('QuizTake');

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
      isMarketplace: quizSchema.isMarketplace,
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
    .where(eq(quizSchema.slug, params.slug))
    .limit(1);

  // Q2 + Q3: 私有或找不到 → 404（不洩漏存在性）
  if (!quiz || quiz.visibility === 'private') {
    notFound();
  }

  // visibility 公開但 quiz 還未發佈（理論不該發生,但 schema 兩個欄位獨立,保險檢查）
  if (quiz.status !== 'published') {
    notFound();
  }

  // 到期檢查（對齊 /quiz/[accessCode] 行為）
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
