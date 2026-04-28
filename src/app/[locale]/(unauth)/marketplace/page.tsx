import { and, count, desc, eq, ilike, or } from 'drizzle-orm';
import Link from 'next/link';

import { MarketplaceCard } from '@/features/marketplace/MarketplaceCard';
import { MarketplaceVocabCard } from '@/features/marketplace/MarketplaceVocabCard';
import { db } from '@/libs/DB';
import { questionSchema, quizSchema, vocabCardSchema, vocabSetSchema } from '@/models/Schema';
import { GRADE_LEVELS, MARKETPLACE_CATEGORIES } from '@/utils/MarketplaceConfig';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '題庫市集 — QuizFlow',
  description: '瀏覽其他老師分享的優質測驗與單字卡集，一鍵複製到自己的帳號使用。',
};

type MarketplaceType = 'quiz' | 'vocab';

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: { category?: string; grade?: string; q?: string; type?: string };
}) {
  const { category, grade, q } = searchParams;
  // type 白名單：只接受 'quiz' / 'vocab'，其他值（含未提供）一律當作 quiz
  const tabType: MarketplaceType = searchParams.type === 'vocab' ? 'vocab' : 'quiz';

  // 兩種 tab 共用 query string builder（保留其他參數）
  const buildHref = (overrides: Partial<{ type: MarketplaceType; category: string; grade: string; q: string }>) => {
    const params = new URLSearchParams();
    const next = {
      type: overrides.type ?? tabType,
      category: 'category' in overrides ? overrides.category : category,
      grade: 'grade' in overrides ? overrides.grade : grade,
      q: 'q' in overrides ? overrides.q : q,
    };
    if (next.type && next.type !== 'quiz') {
      params.set('type', next.type);
    }
    if (next.category) {
      params.set('category', next.category);
    }
    if (next.grade) {
      params.set('grade', next.grade);
    }
    if (next.q) {
      params.set('q', next.q);
    }
    const qs = params.toString();
    return qs ? `/marketplace?${qs}` : '/marketplace';
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      {/* 標題 */}
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight">題庫市集</h1>
        <p className="mt-2 text-muted-foreground">瀏覽老師們分享的優質測驗與單字卡集，一鍵複製使用</p>
      </div>

      {/* Tab：測驗 / 單字卡 */}
      <div className="mb-6 flex gap-2 border-b">
        <Link
          href={buildHref({ type: 'quiz' })}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            tabType === 'quiz'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          測驗
        </Link>
        <Link
          href={buildHref({ type: 'vocab' })}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            tabType === 'vocab'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          單字卡
        </Link>
      </div>

      {/* 篩選列 */}
      <div className="mb-6 flex flex-wrap gap-3">
        <form className="flex flex-1 gap-2" action="/marketplace" method="GET">
          <input
            name="q"
            defaultValue={q ?? ''}
            placeholder={tabType === 'vocab' ? '搜尋單字卡集標題...' : '搜尋測驗標題...'}
            className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {tabType !== 'quiz' && <input type="hidden" name="type" value={tabType} />}
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

      {/* 科目篩選 */}
      <div className="mb-6 flex flex-wrap gap-2">
        <Link
          href={buildHref({ category: undefined })}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${!category ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
        >
          全部
        </Link>
        {MARKETPLACE_CATEGORIES.map(c => (
          <Link
            key={c}
            href={buildHref({ category: c })}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${category === c ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
          >
            {c}
          </Link>
        ))}
      </div>

      {/* 年級篩選 */}
      <div className="mb-8 flex flex-wrap gap-2">
        <Link
          href={buildHref({ grade: undefined })}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${!grade ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
        >
          全年級
        </Link>
        {GRADE_LEVELS.map(g => (
          <Link
            key={g}
            href={buildHref({ grade: g })}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${grade === g ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
          >
            {g}
          </Link>
        ))}
      </div>

      {/* 列表（依 tab 分支渲染） */}
      {tabType === 'vocab'
        ? <VocabList category={category} grade={grade} q={q} />
        : <QuizList category={category} grade={grade} q={q} />}
    </div>
  );
}

// ---------- Quiz 列表 ----------

async function QuizList({ category, grade, q }: { category?: string; grade?: string; q?: string }) {
  const conditions = [eq(quizSchema.visibility, 'public')];
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
    .orderBy(desc(quizSchema.forkCount), desc(quizSchema.createdAt))
    .limit(50);

  const quizIds = quizzes.map(item => item.id);
  let questionCounts = new Map<number, number>();
  if (quizIds.length > 0) {
    const rows = await db
      .select({ quizId: questionSchema.quizId, total: count() })
      .from(questionSchema)
      .where(or(...quizIds.map(id => eq(questionSchema.quizId, id)))!)
      .groupBy(questionSchema.quizId);
    questionCounts = new Map(rows.map(r => [r.quizId, r.total]));
  }

  if (quizzes.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed py-16 text-center">
        <p className="text-lg font-medium text-muted-foreground">目前還沒有符合條件的測驗</p>
        <p className="mt-1 text-sm text-muted-foreground">快來分享你的第一份測驗吧！</p>
      </div>
    );
  }

  return (
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
            forkCount: quiz.forkCount,
            createdAt: quiz.createdAt.toISOString(),
          }}
          questionCount={questionCounts.get(quiz.id) ?? 0}
        />
      ))}
    </div>
  );
}

// ---------- Vocab 列表 ----------

async function VocabList({ category, grade, q }: { category?: string; grade?: string; q?: string }) {
  const conditions = [eq(vocabSetSchema.visibility, 'public')];
  if (category) {
    conditions.push(eq(vocabSetSchema.category, category));
  }
  if (grade) {
    conditions.push(eq(vocabSetSchema.gradeLevel, grade));
  }
  if (q) {
    conditions.push(ilike(vocabSetSchema.title, `%${q}%`));
  }

  const sets = await db
    .select()
    .from(vocabSetSchema)
    .where(and(...conditions))
    .orderBy(desc(vocabSetSchema.forkCount), desc(vocabSetSchema.createdAt))
    .limit(50);

  const setIds = sets.map(s => s.id);
  let cardCounts = new Map<number, number>();
  if (setIds.length > 0) {
    const rows = await db
      .select({ setId: vocabCardSchema.setId, total: count() })
      .from(vocabCardSchema)
      .where(or(...setIds.map(id => eq(vocabCardSchema.setId, id)))!)
      .groupBy(vocabCardSchema.setId);
    cardCounts = new Map(rows.map(r => [r.setId, r.total]));
  }

  if (sets.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed py-16 text-center">
        <p className="text-lg font-medium text-muted-foreground">目前還沒有符合條件的單字卡集</p>
        <p className="mt-1 text-sm text-muted-foreground">快來分享你的第一組單字卡吧！</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sets.map(set => (
        <MarketplaceVocabCard
          key={set.id}
          set={{
            id: set.id,
            title: set.title,
            accessCode: set.accessCode,
            category: set.category,
            gradeLevel: set.gradeLevel,
            forkCount: set.forkCount,
            createdAt: set.createdAt.toISOString(),
          }}
          cardCount={cardCounts.get(set.id) ?? 0}
        />
      ))}
    </div>
  );
}
