import { asc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { QuizTaker } from '@/features/quiz/QuizTaker';
import { VocabTaker } from '@/features/quiz/VocabTaker';
import { db } from '@/libs/DB';
import { questionSchema, quizSchema } from '@/models/Schema';

// 學生作答頁底部品牌 + 註冊 CTA（病毒迴圈入口）
// 學生看到後可知道：這是 QuizFlow → 老師也能免費建測驗 → 可能自己變老師
function StudentFooter() {
  return (
    <footer className="mt-8 border-t border-border/50 pb-12 pt-6 text-center text-xs text-muted-foreground">
      <p>
        由
        {' '}
        <Link href="/" className="font-semibold text-primary hover:underline">
          QuizFlow
        </Link>
        {' '}
        提供，老師出題平台
      </p>
      <p className="mt-2">
        <Link
          href="/sign-up?ref=student-footer"
          className="text-primary hover:underline"
        >
          你也想出題給學生？免費建立你的第一份測驗 →
        </Link>
      </p>
    </footer>
  );
}

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
  // 用全欄位 select 避免 schema 擴充時 Taker 元件型別不符（PR #27 加了 publisher 欄位）
  const [quiz] = await db
    .select()
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
          <StudentFooter />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50/60 via-white to-emerald-50/30 pb-24 pt-10 md:py-16 md:pb-24">
      <div className="mx-auto max-w-2xl px-4">
        <QuizTaker quiz={quiz} questions={questions} />
        <StudentFooter />
      </div>
    </div>
  );
}

export const dynamic = 'force-dynamic';
