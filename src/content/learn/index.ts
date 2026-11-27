import linearEquation from './pages/math--linear-equation-one-variable.json';
import density from './pages/science--density.json';
import type { LearnPage, LearnSubjectSlug } from './types';

export type { LearnPage, LearnQuestion, LearnSubjectSlug } from './types';

// 新增內容頁：在 pages/ 放 `<subject>--<topic>.json`，再加進下面陣列
export const learnPages: LearnPage[] = [
  linearEquation,
  density,
] as LearnPage[];

export const LEARN_SUBJECT_NAMES: Record<LearnSubjectSlug, string> = {
  math: '數學',
  science: '自然',
  it: '資訊科技',
  english: '英文',
};

export function getLearnPage(subject: string, topic: string): LearnPage | undefined {
  return learnPages.find(p => p.subject === subject && p.topic === topic);
}

export function getLearnPath(p: Pick<LearnPage, 'subject' | 'topic'>): string {
  return `/learn/${p.subject}/${p.topic}`;
}

// 同科目優先、再補其他科目，當作頁尾「更多練習」內部連結
export function getRelatedLearnPages(p: LearnPage, limit = 4): LearnPage[] {
  const others = learnPages.filter(o => !(o.subject === p.subject && o.topic === p.topic));
  const same = others.filter(o => o.subject === p.subject);
  const rest = others.filter(o => o.subject !== p.subject);
  return [...same, ...rest].slice(0, limit);
}
