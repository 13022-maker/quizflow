import { chineseTemplates } from './chinese';
import { englishTemplates } from './english';
import { mathTemplates } from './math';
import { scienceTemplates } from './science';
import { socialTemplates } from './social';
import type { QuizTemplate, TemplateSubject } from './types';

export type { QuizTemplate, TemplateQuestion, TemplateSubject } from './types';

export const TEMPLATE_SUBJECTS: TemplateSubject[] = [
  '國文',
  '英語',
  '數學',
  '自然',
  '社會',
];

export const quizTemplates: QuizTemplate[] = [
  ...chineseTemplates,
  ...englishTemplates,
  ...mathTemplates,
  ...scienceTemplates,
  ...socialTemplates,
];

export function getTemplateBySlug(slug: string): QuizTemplate | undefined {
  return quizTemplates.find(t => t.slug === slug);
}

export function getTemplatesBySubject(subject: TemplateSubject): QuizTemplate[] {
  return quizTemplates.filter(t => t.subject === subject);
}

export function getRelatedTemplates(slug: string, limit = 3): QuizTemplate[] {
  const current = getTemplateBySlug(slug);
  if (!current) {
    return [];
  }
  const candidates = quizTemplates.filter(t => t.slug !== slug);
  const sameSubject = candidates.filter(t => t.subject === current.subject);
  const others = candidates.filter(t => t.subject !== current.subject);
  return [...sameSubject, ...others].slice(0, limit);
}
