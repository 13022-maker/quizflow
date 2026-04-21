import Link from 'next/link';
import { unstable_setRequestLocale } from 'next-intl/server';

import { quizTemplates, TEMPLATE_SUBJECTS, type TemplateSubject } from '@/data/templates';
import { TemplateCard } from '@/features/templates/TemplateCard';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

export const metadata = {
  title: '免費測驗範本庫 — QuizFlow（國小、國中、高中分科精選）',
  description:
    '精選 25+ 份分科分年級的免費測驗範本，涵蓋國文、英語、數學、自然、社會，所有題目皆附詳解，老師可一鍵複製到自己帳號使用。',
  alternates: { canonical: '/templates' },
};

type Props = {
  params: { locale: string };
  searchParams: { subject?: string };
};

export default function TemplatesIndexPage({ params, searchParams }: Props) {
  unstable_setRequestLocale(params.locale);

  const selected = searchParams.subject as TemplateSubject | undefined;
  const list = selected
    ? quizTemplates.filter(t => t.subject === selected)
    : quizTemplates;

  return (
    <>
      <Navbar />

      <main className="mx-auto max-w-6xl px-4 pb-20 pt-8">
        <header className="border-b pb-8">
          <p className="text-sm font-medium text-primary">QuizFlow 測驗範本庫</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            免費測驗範本：國小到高中，覆蓋五大科目
          </h1>
          <p className="mt-3 max-w-2xl text-base text-muted-foreground">
            每份範本皆由老師審核、附詳解與難度標籤。註冊後可一鍵複製到個人帳號，直接分享給學生作答。
          </p>
        </header>

        {/* 科目篩選 */}
        <div className="mt-8 flex flex-wrap gap-2">
          <Link
            href="/templates"
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              !selected
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            全部
          </Link>
          {TEMPLATE_SUBJECTS.map(s => (
            <Link
              key={s}
              href={`/templates?subject=${encodeURIComponent(s)}`}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                selected === s
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {s}
            </Link>
          ))}
        </div>

        <section className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {list.map(t => (
            <TemplateCard key={t.slug} template={t} />
          ))}
        </section>

        {list.length === 0 && (
          <p className="py-20 text-center text-muted-foreground">此科目暫無範本。</p>
        )}
      </main>

      <Footer />
    </>
  );
}
