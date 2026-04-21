/**
 * 部落格文章型別定義
 * 以結構化 blocks 取代 MDX，避免額外套件依賴，支援 SSR 與 SEO 靜態化
 */

export type BlogBlock =
  | { type: 'h2'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'quote'; text: string; cite?: string }
  | {
    type: 'cta';
    title: string;
    description: string;
    href: string;
    label: string;
  }
  | {
    type: 'faq';
    items: { q: string; a: string }[];
  };

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  keywords: string[];
  category: BlogCategory;
  publishedAt: string;
  updatedAt?: string;
  readingMinutes: number;
  author: string;
  tags: string[];
  body: BlogBlock[];
};

export const BLOG_CATEGORIES = {
  'ai-teaching': 'AI 教學',
  'quiz-design': '出題技巧',
  'tools-compare': '工具比較',
  'curriculum': '課綱素養',
  'classroom': '教室實務',
  'exam-prep': '考試準備',
} as const;

export type BlogCategory = keyof typeof BLOG_CATEGORIES;
