import { and, count, desc, eq, ilike, or } from 'drizzle-orm';
import Link from 'next/link';

import { MarketplaceCard } from '@/features/marketplace/MarketplaceCard';
import { db } from '@/libs/DB';
import { questionSchema, quizSchema } from '@/models/Schema';
import { GRADE_LEVELS, MARKETPLACE_CATEGORIES } from '@/utils/MarketplaceConfig';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '題庫市集 — QuizFlow',
  description: '瀏覽其他老師分享的優質測驗，一鍵複製到自己的帳號使用。',
};

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: { category?: string; grade?: string; q?: string };
}) {
  const { category, grade, q } = searchParams;

  const conditions = [eq(quizSchema.isMarketplace, true)];
  if (category) {
    conditions.push(eq(quizSchema.category, category));
  }
  if (grade) {
    conditions.push(eq(quizSchema.gradeLevel, grade));
  }
  if (q) {
    conditions.push(
      or(
        ilike(quizSchema.title, `%${q}%`),
        ilike(quizSchema.description, `%${q}%`),
      )!,
    );
  }

  const quizzes = await db
    .select()
    .from(quizSchema)
    .where(and(...conditions))
    .orderBy(desc(quizSchema.copyCount), desc(quizSchema.createdAt))
    .limit(50);

  const quizIds = quizzes.map(q => q.id);
  let questionCounts = new Map<number, number>();
  if (quizIds.length > 0) {
    const rows = await db
      .select({ quizId: questionSchema.quizId, total: count() })
      .from(questionSchema)
      .where(
        or(...quizIds.map(id => eq(questionSchema.quizId, id)))!,
      )
      .groupBy(questionSchema.quizId);
    questionCounts = new Map(rows.map(r => [r.quizId, r.total]));
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      {/* 標題 */}
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight">題庫市集</h1>
        <p className="mt-2 text-muted-foreground">瀏覽老師們分享的優質測驗，一鍵複製使用</p>
      </div>

      {/* 篩選列 */}
      <div className="mb-6 flex flex-wrap gap-3">
        <form className="flex flex-1 gap-2" action="/marketplace" method="GET">
          <input
            name="q"
            defaultValue={q ?? ''}
            placeholder="搜尋測驗標題..."
            className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {category && <input type="hidden" name="category" value={category} />}
          {grade && <input type="hidden" name="grade" value={grade} />}
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            搜尋
          </button>
        </form>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <Link
          href="/marketplace"
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${!category ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
        >
          全部
        </Link>
        {MARKETPLACE_CATEGORIES.map(c => (
          <Link
            key={c}
            href={`/marketplace?category=${c}${grade ? `&grade=${grade}` : ''}${q ? `&q=${q}` : ''}`}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${category === c ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
          >
            {c}
          </Link>
        ))}
      </div>

      <div className="mb-8 flex flex-wrap gap-2">
        <Link
          href={`/marketplace${category ? `?category=${category}` : ''}${q ? `${category ? '&' : '?'}q=${q}` : ''}`}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${!grade ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
        >
          全年級
        </Link>
        {GRADE_LEVELS.map(g => (
          <Link
            key={g}
            href={`/marketplace?grade=${g}${category ? `&category=${category}` : ''}${q ? `&q=${q}` : ''}`}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${grade === g ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
          >
            {g}
          </Link>
        ))}
      </div>

      {/* 測驗列表 */}
      {quizzes.length > 0
        ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {quizzes.map(quiz => (
                <MarketplaceCard
                  key={quiz.id}
                  quiz={{
                    id: quiz.id,
                    title: quiz.title,
                    description: quiz.description,
                    category: quiz.category,
                    gradeLevel: quiz.gradeLevel,
                    tags: quiz.tags,
                    copyCount: quiz.copyCount,
                    createdAt: quiz.createdAt.toISOString(),
                  }}
                  questionCount={questionCounts.get(quiz.id) ?? 0}
                />
              ))}
            </div>
          )
        : (
            <div className="rounded-xl border-2 border-dashed py-16 text-center">
              <p className="text-lg font-medium text-muted-foreground">目前還沒有符合條件的測驗</p>
              <p className="mt-1 text-sm text-muted-foreground">快來分享你的第一份測驗吧！</p>
            </div>
          )}
    </div>
  );
}
