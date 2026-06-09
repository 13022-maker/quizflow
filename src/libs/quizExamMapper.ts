// src/libs/quizExamMapper.ts
// 將 QuizFlow 測驗題目（DB 格式）映射成段考考卷格式（TeacherExamInput）。
//
// 頁首資訊目前「寫死」成啟英高中段考參照值（見 EXAM_HEADER）。
// 每次段考若期別／範圍／班級不同，直接改這裡的常數，或在匯出後的 Word 檔內修改即可。

import type { InferSelectModel } from 'drizzle-orm';

import { stripOptionLabel } from '@/lib/ai/optionText';
import type { questionSchema } from '@/models/Schema';

import type {
  ExamVariant,
  TeacherExamChoiceQuestion,
  TeacherExamInput,
  TeacherExamShortQuestion,
} from './teacherExam';

type Question = InferSelectModel<typeof questionSchema>;

// ─── 頁首常數（寫死；要改段考資訊改這裡）──────────────────────────────────────
export const EXAM_HEADER = {
  school: '啟英高中',
  academicYear: '114',
  semester: '1',
  examPeriod: '期初' as const,
  subject: '程式語言',
  classType: '僑生班' as const,
  applicableClass: '僑資二甲B班',
  teacherName: '謝金洪',
  scope: 'ch1~ch3',
};

// 是非題 DB 無 options 時的預設選項（與系統其他處一致）
const TF_DEFAULTS = [
  { id: 'tf-true', text: '正確' },
  { id: 'tf-false', text: '錯誤' },
];

// 選擇題類型（含是非）
const CHOICE_TYPES = new Set(['single_choice', 'multiple_choice', 'true_false']);

// 單一題目 → 選擇題格式（含正解索引）
function toChoiceQuestion(q: Question): TeacherExamChoiceQuestion {
  // 是非題若 DB options 為空，補上預設「正確 / 錯誤」
  const rawOptions
    = q.type === 'true_false' && (!q.options || q.options.length === 0)
      ? TF_DEFAULTS
      : (q.options ?? []);

  const optionTexts = rawOptions.map(o => stripOptionLabel(o.text));
  const optionIds = rawOptions.map(o => o.id);

  // correctAnswers 是 option id 陣列 → 轉成索引
  const answerIndices = (q.correctAnswers ?? [])
    .map(id => optionIds.indexOf(id))
    .filter(idx => idx >= 0);

  return {
    stem: q.body,
    options: optionTexts,
    points: q.points,
    answerIndices,
  };
}

// 單一題目 → 簡答題格式
function toShortQuestion(q: Question): TeacherExamShortQuestion {
  return {
    stem: q.body,
    points: q.points,
    refAnswer: q.correctAnswers?.[0],
  };
}

/**
 * 將測驗題目映射成段考考卷輸入。
 * - single_choice / multiple_choice / true_false → 選擇題區（含答案欄）
 * - short_answer → 簡答題區
 * - ranking → 暫不支援，略過
 */
export function quizToTeacherExam(
  questions: Question[],
  variant: ExamVariant,
): TeacherExamInput {
  const choices = questions
    .filter(q => CHOICE_TYPES.has(q.type))
    .map(toChoiceQuestion);

  const shortAnswers = questions
    .filter(q => q.type === 'short_answer')
    .map(toShortQuestion);

  return {
    ...EXAM_HEADER,
    variant,
    questions: choices,
    shortAnswers,
  };
}
