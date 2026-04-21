import { aiTeachingPosts } from './posts/ai-teaching';
import { classroomPosts } from './posts/classroom';
import { curriculumPosts } from './posts/curriculum';
import { examPrepPosts } from './posts/exam-prep';
import { quizDesignPosts } from './posts/quiz-design';
import { toolsComparePosts } from './posts/tools-compare';
import type { BlogPost } from './types';

export type { BlogBlock, BlogCategory, BlogPost } from './types';
export { BLOG_CATEGORIES } from './types';

export const blogPosts: BlogPost[] = [
  ...aiTeachingPosts,
  ...quizDesignPosts,
  ...toolsComparePosts,
  ...curriculumPosts,
  ...classroomPosts,
  ...examPrepPosts,
].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));

export function getPostBySlug(slug: string): BlogPost | undefined {
  return blogPosts.find(p => p.slug === slug);
}

export function getPostsByCategory(category: string): BlogPost[] {
  return blogPosts.filter(p => p.category === category);
}

export function getRelatedPosts(slug: string, limit = 3): BlogPost[] {
  const current = getPostBySlug(slug);
  if (!current) {
    return [];
  }
  const candidates = blogPosts.filter(p => p.slug !== slug);
  const sameCategory = candidates.filter(p => p.category === current.category);
  const others = candidates.filter(p => p.category !== current.category);
  return [...sameCategory, ...others].slice(0, limit);
}
