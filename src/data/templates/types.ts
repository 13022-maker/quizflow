/**
 * 公開範本測驗型別定義
 * 這些範本是靜態 SEO 頁面的資料來源，提供老師預覽 + 一鍵複製到自己帳號
 */

export type TemplateQuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'true_false'
  | 'short_answer';

export type TemplateQuestion = {
  type: TemplateQuestionType;
  question: string;
  options?: string[];
  // single_choice: 選項 index；true_false: 布林；short_answer: 文字
  answer: string | number | boolean | number[];
  explanation: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
};

export type TemplateSubject =
  | '國文'
  | '英語'
  | '數學'
  // 自然合科（國小／國中／高職）
  | '自然'
  // 自然分科（高中以上常見）
  | '物理'
  | '化學'
  | '生物'
  | '地科'
  // 社會合科（國小／國中／高職）
  | '社會'
  // 社會分科（高中以上常見）
  | '歷史'
  | '地理'
  | '公民';

// 範本對應的考試類型（一個範本可標多個）
export type TemplateExam =
  | '會考'
  | '學測'
  | '指考'
  | '統測'
  | '英檢'
  | '證照';

export type QuizTemplate = {
  slug: string;
  title: string;
  subject: TemplateSubject;
  gradeLevel: string;
  description: string;
  keywords: string[];
  tags: string[];
  estimatedMinutes: number;
  questions: TemplateQuestion[];
  exam?: TemplateExam[];
};
