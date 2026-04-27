import { chineseTemplates } from './chinese';
import { englishTemplates } from './english';
import { mathTemplates } from './math';
import { scienceTemplates } from './science';
import { socialTemplates } from './social';
import type { QuizTemplate, TemplateExam, TemplateSubject } from './types';

export type { QuizTemplate, TemplateExam, TemplateQuestion, TemplateSubject } from './types';

// 科目顯示順序：基礎 5 科 → 自然分科 → 社會分科
export const TEMPLATE_SUBJECTS: TemplateSubject[] = [
  '國文',
  '英語',
  '數學',
  '自然',
  '物理',
  '化學',
  '生物',
  '地科',
  '社會',
  '歷史',
  '地理',
  '公民',
];

// 考試類型（依台灣升學體系排序）
export const TEMPLATE_EXAMS: TemplateExam[] = [
  '會考',
  '學測',
  '指考',
  '統測',
  '英檢',
  '證照',
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

// 只回傳實際有範本的科目（避免 UI 出現空 chip，例如還沒補的「地科」「地理」）
export function getAvailableSubjects(): TemplateSubject[] {
  return TEMPLATE_SUBJECTS.filter(s => quizTemplates.some(t => t.subject === s));
}

export function getTemplatesByGrade(grade: TemplateGrade): QuizTemplate[] {
  return quizTemplates.filter(t => getTemplateGrade(t) === grade);
}

export function getTemplatesByExam(exam: TemplateExam): QuizTemplate[] {
  return quizTemplates.filter(t => t.exam?.includes(exam));
}

// 只回傳目前有對應範本的考試類型（避免 UI 出現空 chip）
export function getAvailableExams(): TemplateExam[] {
  return TEMPLATE_EXAMS.filter(e => quizTemplates.some(t => t.exam?.includes(e)));
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
