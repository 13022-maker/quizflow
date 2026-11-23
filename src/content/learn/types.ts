/**
 * SEO 長尾公開練習頁（/learn/[subject]/[topic]）的內容型別
 * 內容放在 src/content/learn/pages/*.json（不寫資料庫），build 時靜態產生
 */

// URL 用的科目 slug（英文）；顯示名稱見 LEARN_SUBJECT_NAMES
export type LearnSubjectSlug = 'math' | 'science' | 'it' | 'english';

export type LearnQuestion = {
  question: string;
  // 目前只收單選題（4 個選項）
  options: string[];
  // 正解選項 index（0-based）
  answer: number;
  explanation: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
};

export type LearnPage = {
  subject: LearnSubjectSlug;
  topic: string; // URL slug（kebab-case 英文）
  unit: string; // 單元名稱（中文）
  gradeLevel: string; // 國一／國二／高一…
  curriculum: string; // 對應 108 課綱位置
  title: string;
  description: string;
  keywords: string[];
  intro: string; // 單元白話說明 150–250 字
  updatedAt: string; // YYYY-MM-DD
  questions: LearnQuestion[];
};
