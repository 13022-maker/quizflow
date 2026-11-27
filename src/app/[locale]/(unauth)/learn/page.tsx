import Link from 'next/link';
import { unstable_setRequestLocale } from 'next-intl/server';

import { getLearnPath, LEARN_SUBJECT_NAMES, learnPages, type LearnSubjectSlug } from '@/content/learn';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';
import { getBaseUrl } from '@/utils/Helpers';

export const metadata = {
  title: '國中・高中免費線上練習題（108 課綱，附詳解）— QuizFlow',
  description:
    '對齊 108 課綱的國中、高中數學、自然、資訊科技、英文免費線上練習題，每個單元 10 題附詳解，免登入立即作答、自動批改。',
  alternates: { canonical: `${getBaseUrl()}/learn` },
};

type Props = {
  params: { locale: string };
};

export default function LearnIndexPage({ params }: Props) {
  unstable_setRequestLocale(params.locale);

  const subjects = (Object.keys(LEARN_SUBJECT_NAMES) as LearnSubjectSlug[])
    .map(s => ({ slug: s, name: LEARN_SUBJECT_NAMES[s], pages: learnPages.filter(p => p.subject === s) }))
    .filter(s => s.pages.length > 0);

  return (
    <>
      <Navbar />

      <main className="mx-auto max-w-3xl px-4 pb-16 pt-8">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">免費線上練習題</h1>
        <p className="mt-3 text-foreground/80">
          對齊 108 課綱，每個單元 10 題附詳解，免登入直接作答、交卷立刻看成績。
        </p>

        {subjects.map(s => (
          <section key={s.slug} id={s.slug} className="mt-10">
            <h2 className="text-xl font-bold tracking-tight">{s.name}</h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {s.pages.map(p => (
                <li key={p.topic}>
                  <Link
                    href={getLearnPath(p)}
                    className="block h-full rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted"
                  >
                    <span className="text-xs text-muted-foreground">{p.gradeLevel}</span>
                    <span className="mt-1 block font-medium">{p.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>

      <Footer />
    </>
  );
}
