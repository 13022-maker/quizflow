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

// 學制分組：把 gradeLevel string（國小五年級／高中二年級…）歸類到 5 大學制 bucket
export type TemplateGrade = '國小' | '國中' | '高中' | '高職' | '大學';

export const TEMPLATE_GRADES: TemplateGrade[] = [
  '國小',
  '國中',
  '高中',
  '高職',
  '大學',
];

export function getTemplateGrade(template: QuizTemplate): TemplateGrade | undefined {
  return TEMPLATE_GRADES.find(g => template.gradeLevel.startsWith(g));
}

// 學制 → 該學制下的細年級陣列（依年級順序）
export const TEMPLATE_GRADE_LEVELS_BY_GRADE: Record<TemplateGrade, string[]> = {
  國小: ['國小四年級', '國小五年級', '國小六年級'],
  國中: ['國中一年級', '國中二年級', '國中三年級'],
  高中: ['高中一年級', '高中二年級', '高中三年級'],
  高職: ['高職二年級', '高職三年級'],
  大學: ['大學'],
};

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

export function getTemplatesByGrade(grade: TemplateGrade): QuizTemplate[] {
  return quizTemplates.filter(t => getTemplateGrade(t) === grade);
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
