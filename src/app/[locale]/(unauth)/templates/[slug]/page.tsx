import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { unstable_setRequestLocale } from 'next-intl/server';

import {
  getRelatedTemplates,
  getTemplateBySlug,
  quizTemplates,
} from '@/data/templates';
import { TemplateCard } from '@/features/templates/TemplateCard';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';
import { getBaseUrl } from '@/utils/Helpers';

type Props = {
  params: { locale: string; slug: string };
};

export async function generateStaticParams() {
  return quizTemplates.map(t => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = getTemplateBySlug(params.slug);
  if (!t) {
    return {};
  }
  return {
    title: `${t.title} — QuizFlow 免費測驗範本`,
    description: t.description,
    keywords: t.keywords,
    alternates: { canonical: `/templates/${t.slug}` },
    openGraph: {
      type: 'website',
      url: `${getBaseUrl()}/templates/${t.slug}`,
      title: t.title,
      description: t.description,
    },
  };
}

function renderAnswer(q: { type: string; options?: string[]; answer: unknown }): string {
  if (q.type === 'true_false') {
    return q.answer === true ? '正確 ✓' : '錯誤 ✗';
  }
  if (q.type === 'single_choice' && typeof q.answer === 'number' && q.options) {
    return `${String.fromCharCode(65 + q.answer)}. ${q.options[q.answer]}`;
  }
  if (q.type === 'multiple_choice' && Array.isArray(q.answer) && q.options) {
    return (q.answer as number[])
      .map(i => `${String.fromCharCode(65 + i)}. ${q.options?.[i] ?? ''}`)
      .join('、');
  }
  return String(q.answer);
}

export default function TemplateDetailPage({ params }: Props) {
  unstable_setRequestLocale(params.locale);

  const t = getTemplateBySlug(params.slug);
  if (!t) {
    notFound();
  }

  const related = getRelatedTemplates(t.slug, 3);

  // JSON-LD：Quiz 結構化資料
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Quiz',
    'name': t.title,
    'description': t.description,
    'educationalLevel': t.gradeLevel,
    'about': t.subject,
    'keywords': t.keywords.join(', '),
    'numberOfQuestions': t.questions.length,
    'timeRequired': `PT${t.estimatedMinutes}M`,
  };

  return (
    <>
      <Navbar />

      <article className="mx-auto max-w-3xl px-4 pb-16 pt-8">
        <nav className="text-sm text-muted-foreground">
          <Link href="/templates" className="hover:text-foreground">範本庫</Link>
          {' / '}
          <Link
            href={`/templates?subject=${encodeURIComponent(t.subject)}`}
            className="hover:text-foreground"
          >
            {t.subject}
          </Link>
        </nav>

        <header className="mt-6 border-b pb-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
              {t.subject}
            </span>
            <span>
              ·
              {t.gradeLevel}
            </span>
            <span>·</span>
            <span>
              {t.questions.length}
              {' '}
              題
            </span>
            <span>·</span>
            <span>
              約
              {t.estimatedMinutes}
              {' '}
              分鐘
            </span>
          </div>
          <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            {t.title}
          </h1>
          <p className="mt-4 text-lg text-foreground/80">{t.description}</p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={`/sign-up?redirect_url=/dashboard?import_template=${t.slug}`}
              className="inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              一鍵複製到我的帳號 →
            </Link>
            <Link
              href="/sign-up"
              className="inline-flex items-center rounded-lg border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              免費註冊 QuizFlow
            </Link>
          </div>
        </header>

        {/* 題目預覽 */}
        <section className="mt-10 space-y-6">
          <h2 className="text-xl font-bold tracking-tight">完整題目預覽</h2>
          {t.questions.map((q, i) => (
            <div key={i} className="rounded-2xl border bg-card p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <p className="flex-1 text-base font-medium">
                  <span className="mr-2 text-muted-foreground">
                    Q
                    {i + 1}
                    .
                  </span>
                  {q.question}
                </p>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  難度
                  {' '}
                  {q.difficulty}
                </span>
              </div>

              {q.options && (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {q.options.map((opt, j) => (
                    <li key={j} className="flex gap-2">
                      <span className="text-muted-foreground">
                        {String.fromCharCode(65 + j)}
                        .
                      </span>
                      <span>{opt}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-4 rounded-lg bg-muted/40 p-3 text-sm">
                <p>
                  <span className="font-semibold text-primary">正解：</span>
                  {renderAnswer(q)}
                </p>
                <p className="mt-1 text-foreground/80">
                  <span className="font-semibold">解析：</span>
                  {q.explanation}
                </p>
              </div>
            </div>
          ))}
        </section>

        {/* 底部 CTA */}
        <aside className="mt-12 rounded-2xl border border-primary/20 bg-primary/5 p-6 text-center">
          <h2 className="text-xl font-bold">想用這份範本替你省 30 分鐘備課？</h2>
          <p className="mt-2 text-sm text-foreground/80">
            註冊 QuizFlow 免費帳號，一鍵複製題目、分享連結給學生，系統自動批改並產出分析報表。
          </p>
          <Link
            href={`/sign-up?redirect_url=/dashboard?import_template=${t.slug}`}
            className="mt-4 inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            免費開始使用 →
          </Link>
        </aside>
      </article>

      {related.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pb-20">
          <h2 className="mb-6 text-xl font-bold tracking-tight">相關範本</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {related.map(r => (
              <TemplateCard key={r.slug} template={r} />
            ))}
          </div>
        </section>
      )}

      <Footer />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  );
}
