import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import Link from 'next/link';

import { LiveProctorDashboard } from '@/features/quiz/LiveProctorDashboard';
import { db } from '@/libs/DB';
import { quizSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '即時監考 | QuizFlow',
};

export default async function LiveProctorPage({
  params,
}: {
  params: { locale: string; id: string };
}) {
  const quizId = Number(params.id);
  if (!Number.isFinite(quizId) || quizId <= 0) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-sm text-destructive">網址格式錯誤</p>
      </div>
    );
  }

  const { orgId } = await auth();
  if (!orgId) {
    return null; // middleware 會 redirect
  }

  // 驗 ownership
  const [quiz] = await db
    .select({ id: quizSchema.id, ownerId: quizSchema.ownerId })
    .from(quizSchema)
    .where(eq(quizSchema.id, quizId))
    .limit(1);

  if (!quiz || quiz.ownerId !== orgId) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-xl font-bold">找不到測驗或沒有權限</h1>
        <Link
          href={`/${params.locale}/dashboard/quizzes`}
          className="mt-4 inline-block text-sm text-primary hover:underline"
        >
          ← 返回測驗列表
        </Link>
      </div>
    );
  }

  return <LiveProctorDashboard quizId={quizId} />;
}
