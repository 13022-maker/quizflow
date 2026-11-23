import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { unstable_setRequestLocale } from 'next-intl/server';

import {
  getLearnPage,
  getLearnPath,
  getRelatedLearnPages,
  LEARN_SUBJECT_NAMES,
  type LearnPage,
  learnPages,
} from '@/content/learn';
import { LearnPractice } from '@/features/learn/LearnPractice';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';
import { getBaseUrl } from '@/utils/Helpers';

type Props = {
  params: { locale: string; subject: string; topic: string };
};

// 內容全部來自 repo 內 JSON，build 時靜態產生；未知路徑直接 404
export const dynamicParams = false;

export function generateStaticParams() {
  return learnPages.map(p => ({ subject: p.subject, topic: p.topic }));
}

export function generateMetadata({ params }: Props): Metadata {
  const p = getLearnPage(params.subject, params.topic);
  if (!p) {
    return {};
  }
  const url = `${getBaseUrl()}${getLearnPath(p)}`;
  return {
    title: `${p.title} — QuizFlow 免費線上練習`,
    description: p.description,
    keywords: p.keywords,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      url,
      title: p.title,
      description: p.description,
      locale: 'zh_TW',
    },
  };
}

function buildJsonLd(p: LearnPage) {
  const baseUrl = getBaseUrl();
  const pageUrl = `${baseUrl}${getLearnPath(p)}`;
  const subjectName = LEARN_SUBJECT_NAMES[p.subject];

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': [
      { '@type': 'ListItem', 'position': 1, 'name': '首頁', 'item': baseUrl },
      { '@type': 'ListItem', 'position': 2, 'name': '免費線上練習', 'item': `${baseUrl}/learn` },
      { '@type': 'ListItem', 'position': 3, 'name': `${p.gradeLevel}${subjectName}`, 'item': `${baseUrl}/learn#${p.subject}` },
      { '@type': 'ListItem', 'position': 4, 'name': p.unit, 'item': pageUrl },
    ],
  };

  const quizLd = {
    '@context': 'https://schema.org',
    '@type': 'Quiz',
    'name': p.title,
    'description': p.description,
    'url': pageUrl,
    'about': { '@type': 'Thing', 'name': p.unit },
    'educationalLevel': p.gradeLevel,
    'educationalAlignment': {
      '@type': 'AlignmentObject',
      'alignmentType': 'educationalSubject',
      'educationalFramework': '十二年國民基本教育課程綱要（108 課綱）',
      'targetName': p.curriculum,
    },
    'keywords': p.keywords.join(', '),
    'inLanguage': 'zh-Hant-TW',
    'learningResourceType': 'Practice problem',
    'isAccessibleForFree': true,
    'dateModified': p.updatedAt,
    'publisher': { '@type': 'Organization', 'name': 'QuizFlow', 'url': baseUrl },
    'hasPart': p.questions.map(q => ({
      '@type': 'Question',
      'eduQuestionType': 'Multiple choice',
      'text': q.question,
      'suggestedAnswer': q.options
        .filter((_, i) => i !== q.answer)
        .map(o => ({ '@type': 'Answer', 'text': o })),
      'acceptedAnswer': {
        '@type': 'Answer',
        'text': q.options[q.answer],
        'answerExplanation': { '@type': 'Comment', 'text': q.explanation },
      },
    })),
  };

  return [breadcrumbLd, quizLd];
}

export default function LearnTopicPage({ params }: Props) {
  unstable_setRequestLocale(params.locale);

  const p = getLearnPage(params.subject, params.topic);
  if (!p) {
    notFound();
  }

  const subjectName = LEARN_SUBJECT_NAMES[p.subject];
  const related = getRelatedLearnPages(p, 4);
  // JSON-LD 內 `<` 轉義，避免內容含 </script> 時跳出 script 區塊
  const jsonLd = JSON.stringify(buildJsonLd(p)).replace(/</g, '\\u003c');

  return (
    <>
      <Navbar />

      <article className="mx-auto max-w-3xl px-4 pb-16 pt-8">
        <nav aria-label="麵包屑" className="text-sm text-muted-foreground">
          <Link href="/learn" className="hover:text-foreground">免費線上練習</Link>
          {' / '}
          <span>
            {p.gradeLevel}
            {subjectName}
          </span>
        </nav>

        <header className="mt-6 border-b pb-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
              {p.gradeLevel}
              {subjectName}
            </span>
            <span>
              ·
              {' '}
              {p.questions.length}
              {' '}
              題附詳解
            </span>
            <span>· 免登入作答</span>
          </div>
          <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            {p.title}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{p.curriculum}</p>
        </header>

        <section className="mt-8">
          <h2 className="text-xl font-bold tracking-tight">
            {p.unit}
            {' '}
            重點觀念
          </h2>
          <p className="mt-3 leading-relaxed text-foreground/90">{p.intro}</p>
        </section>

        <section className="mt-10">
          <h2 className="mb-4 text-xl font-bold tracking-tight">
            {p.unit}
            {' '}
            練習題
          </h2>
          <LearnPractice questions={p.questions} />
        </section>

        <aside className="mt-12 rounded-2xl border border-primary/20 bg-primary/5 p-6 text-center">
          <h2 className="text-xl font-bold">老師：用 QuizFlow 30 秒生出一份這樣的考卷</h2>
          <p className="mt-2 text-sm text-foreground/80">
            上傳講義或輸入單元名稱，AI 自動出題、附詳解；分享連結給學生免登入作答，系統自動批改並產出成績報表。
          </p>
          <Link
            href="/sign-up"
            className="mt-4 inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            免費註冊，開始出題 →
          </Link>
        </aside>

        {related.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-4 text-xl font-bold tracking-tight">更多免費練習</h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {related.map(r => (
                <li key={`${r.subject}/${r.topic}`}>
                  <Link
                    href={getLearnPath(r)}
                    className="block rounded-xl border bg-card p-4 text-sm font-medium shadow-sm transition-colors hover:bg-muted"
                  >
                    {r.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>

      <Footer />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
    </>
  );
}
