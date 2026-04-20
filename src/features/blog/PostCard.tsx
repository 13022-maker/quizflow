import Link from 'next/link';

import { BLOG_CATEGORIES, type BlogPost } from '@/data/blog';

export function PostCard({ post }: { post: BlogPost }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group flex h-full flex-col rounded-2xl border bg-card p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
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
      </div>
      <h2 className="mt-3 text-lg font-bold tracking-tight text-foreground group-hover:text-primary">
        {post.title}
      </h2>
      <p className="mt-2 line-clamp-3 flex-1 text-sm text-foreground/70">
        {post.description}
      </p>
      <div className="mt-4 flex flex-wrap gap-1">
        {post.tags.slice(0, 3).map(tag => (
          <span
            key={tag}
            className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
          >
            #
            {tag}
          </span>
        ))}
      </div>
    </Link>
  );
}
