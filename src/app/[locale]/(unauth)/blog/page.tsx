import Link from 'next/link';
import { unstable_setRequestLocale } from 'next-intl/server';

import { blogPosts, BLOG_CATEGORIES, type BlogCategory } from '@/data/blog';
import { PostCard } from '@/features/blog/PostCard';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

export const metadata = {
  title: 'QuizFlow 部落格 — 台灣老師的 AI 出題、課綱對齊、課室實戰心法',
  description:
    'QuizFlow 部落格分享 AI 出題技巧、108 課綱素養評量、Google Classroom 整合、考前衝刺計畫，幫助台灣老師用更少時間做出更好的測驗。',
  alternates: {
    canonical: '/blog',
  },
};

type Props = {
  params: { locale: string };
  searchParams: { category?: string };
};

export default function BlogIndexPage({ params, searchParams }: Props) {
  unstable_setRequestLocale(params.locale);

  const selected = searchParams.category as BlogCategory | undefined;
  const posts = selected
    ? blogPosts.filter(p => p.category === selected)
    : blogPosts;

  return (
    <>
      <Navbar />

      <main className="mx-auto max-w-5xl px-4 pb-20 pt-8">
        <header className="border-b pb-8">
          <p className="text-sm font-medium text-primary">QuizFlow 部落格</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            給台灣老師的 AI 出題與教學評量手冊
          </h1>
          <p className="mt-3 max-w-2xl text-base text-muted-foreground">
            精選 AI 自動出題、108 課綱素養題、PDF 轉測驗、Google Classroom 整合、考試防作弊等實戰文章，
            幫你把備課時間從小時縮短到分鐘。
          </p>
        </header>

        {/* 分類篩選 */}
        <div className="mt-8 flex flex-wrap gap-2">
          <Link
            href="/blog"
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              !selected
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            全部
          </Link>
          {(Object.keys(BLOG_CATEGORIES) as BlogCategory[]).map(key => (
            <Link
              key={key}
              href={`/blog?category=${key}`}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                selected === key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {BLOG_CATEGORIES[key]}
            </Link>
          ))}
        </div>

        {/* 文章列表 */}
        <section className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map(post => (
            <PostCard key={post.slug} post={post} />
          ))}
        </section>

        {posts.length === 0 && (
          <p className="py-20 text-center text-muted-foreground">此分類暫無文章。</p>
        )}
      </main>

      <Footer />
    </>
  );
}
