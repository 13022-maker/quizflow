import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { unstable_setRequestLocale } from 'next-intl/server';

import {
  blogPosts,
  BLOG_CATEGORIES,
  getPostBySlug,
  getRelatedPosts,
} from '@/data/blog';
import { PostBody } from '@/features/blog/PostBody';
import { PostCard } from '@/features/blog/PostCard';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';
import { getBaseUrl } from '@/utils/Helpers';

type Props = {
  params: { locale: string; slug: string };
};

export async function generateStaticParams() {
  return blogPosts.map(p => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = getPostBySlug(params.slug);
  if (!post) return {};
  const url = `${getBaseUrl()}/blog/${post.slug}`;
  return {
    title: `${post.title} — QuizFlow 部落格`,
    description: post.description,
    keywords: post.keywords,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: 'article',
      url,
      title: post.title,
      description: post.description,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt ?? post.publishedAt,
      authors: [post.author],
      tags: post.tags,
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
    },
  };
}

export default function BlogPostPage({ params }: Props) {
  unstable_setRequestLocale(params.locale);

  const post = getPostBySlug(params.slug);
  if (!post) notFound();

  const related = getRelatedPosts(post.slug, 3);
  const url = `${getBaseUrl()}/blog/${post.slug}`;

  // JSON-LD 結構化資料，提升 Google 收錄
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    'headline': post.title,
    'description': post.description,
    'datePublished': post.publishedAt,
    'dateModified': post.updatedAt ?? post.publishedAt,
    'author': { '@type': 'Organization', 'name': post.author },
    'publisher': {
      '@type': 'Organization',
      'name': 'QuizFlow',
      'logo': {
        '@type': 'ImageObject',
        'url': `${getBaseUrl()}/apple-touch-icon.png`,
      },
    },
    'mainEntityOfPage': url,
    'keywords': post.keywords.join(', '),
  };

  return (
    <>
      <Navbar />

      <article className="mx-auto max-w-3xl px-4 pb-16 pt-8">
        <nav className="text-sm text-muted-foreground">
          <Link href="/blog" className="hover:text-foreground">部落格</Link>
          {' / '}
          <Link
            href={`/blog?category=${post.category}`}
            className="hover:text-foreground"
          >
            {BLOG_CATEGORIES[post.category]}
          </Link>
        </nav>

        <header className="mt-6 border-b pb-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
              {BLOG_CATEGORIES[post.category]}
            </span>
            <span>·</span>
            <time dateTime={post.publishedAt}>{post.publishedAt}</time>
            <span>·</span>
            <span>
              {post.readingMinutes}
              {' '}
              分鐘閱讀
            </span>
            <span>·</span>
            <span>{post.author}</span>
          </div>
          <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            {post.title}
          </h1>
          <p className="mt-4 text-lg text-foreground/80">{post.description}</p>
        </header>

        <PostBody blocks={post.body} />

        {/* Tags */}
        <div className="mt-10 flex flex-wrap gap-1 border-t pt-6">
          {post.tags.map(tag => (
            <span
              key={tag}
              className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
            >
              #
              {tag}
            </span>
          ))}
        </div>
      </article>

      {/* 延伸閱讀 */}
      {related.length > 0 && (
        <section className="mx-auto max-w-5xl px-4 pb-20">
          <h2 className="mb-6 text-xl font-bold tracking-tight">延伸閱讀</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {related.map(r => (
              <PostCard key={r.slug} post={r} />
            ))}
          </div>
        </section>
      )}

      <Footer />

      {/* eslint-disable-next-line react/no-danger */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  );
}
