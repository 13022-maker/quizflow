import { and, eq, isNotNull } from 'drizzle-orm';
import type { MetadataRoute } from 'next';

import { blogPosts } from '@/data/blog';
import { quizTemplates } from '@/data/templates';
import { db } from '@/libs/DB';
import { quizSchema } from '@/models/Schema';
import { getBaseUrl } from '@/utils/Helpers';

// 每小時重新抓 sitemap(避免每次搜尋引擎請求都查 DB,但仍能反映 public quiz 增減)
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getBaseUrl();
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${base}/pricing`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${base}/blog`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${base}/templates`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${base}/marketplace`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
  ];

  const blogRoutes: MetadataRoute.Sitemap = blogPosts.map(p => ({
    url: `${base}/blog/${p.slug}`,
    lastModified: new Date(p.updatedAt ?? p.publishedAt),
    changeFrequency: 'monthly',
    priority: 0.7,
  }));

  const templateRoutes: MetadataRoute.Sitemap = quizTemplates.map(t => ({
    url: `${base}/templates/${t.slug}`,
    lastModified: now,
    changeFrequency: 'monthly',
    priority: 0.7,
  }));

  // 社群化 Phase 1 commit 4: 收 visibility=public 已發佈 quiz 進 sitemap
  // unlisted 故意不收(unlisted 的目的就是「不被搜尋引擎索引但連結可用」)
  const publicQuizzes = await db
    .select({
      slug: quizSchema.slug,
      updatedAt: quizSchema.updatedAt,
      publishedAt: quizSchema.publishedAt,
    })
    .from(quizSchema)
    .where(
      and(
        eq(quizSchema.visibility, 'public'),
        eq(quizSchema.status, 'published'),
        isNotNull(quizSchema.slug),
      ),
    );

  const quizRoutes: MetadataRoute.Sitemap = publicQuizzes
    .filter((q): q is typeof q & { slug: string } => q.slug !== null)
    .map(q => ({
      url: `${base}/q/${q.slug}`,
      lastModified: q.updatedAt ?? q.publishedAt ?? now,
      changeFrequency: 'monthly',
      priority: 0.6,
    }));

  return [...staticRoutes, ...blogRoutes, ...templateRoutes, ...quizRoutes];
}
