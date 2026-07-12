/**
 * ============================================================================
 * 學科註冊表 (Subject Registry)
 * ============================================================================
 * 引擎本身是純演算法（BKT、派題、知識點鎖定），不含任何學科內容；
 * 每個學科的「知識圖譜 + 題庫」獨立成一個檔案放在本目錄，
 * 透過 subjectId（如 'cpp'、'python'）在執行期動態選取。
 *
 * 新增學科兩步驟：
 *   1. 新增 subjects/<id>.ts，export 一個 Subject 物件（參考 cpp.ts）
 *   2. 在下方 SUBJECTS 註冊表加一行
 *
 * 註：採「靜態 import ＋ Map 查表」而非 fs 掃描／動態 import()——
 * 型別安全、Node 直接執行與 Next.js 打包兩種環境都不需要特殊處理。
 * ============================================================================
 */

import type { ItemBank, KnowledgeGraph } from '../engine';
import { calculusSubject } from './calculus';
import { cppSubject } from './cpp';
import { pythonSubject } from './python';

/** 導師提示詞的學科客製段落（LLM 生成課文與即答時使用） */
export type TutorProfile = {
  /** 課文「重點講解」一節的範例形式要求（程式學科=可執行程式碼；數學學科=逐步算式推導） */
  lessonExampleRule: string;
  /**
   * 表達格式規則（課文與劃線即答共用）。
   * 注意：數學類學科務必要求「純文字/Unicode 數學式、禁用 LaTeX」——
   * 模型預設愛用 LaTeX（$、\frac），但前端的 Markdown 渲染不支援。
   */
  formatRule: string;
};

/** 一個學科 = 識別碼 + 顯示名稱 + 知識圖譜 + 題庫 + 導師風格 */
export type Subject = {
  id: string; // subjectId，用於 API 與儲存檔名（如 'cpp'）
  name: string; // 顯示名稱（如 'C++ 程式設計'）
  graph: KnowledgeGraph;
  itemBank: ItemBank;
  tutor: TutorProfile;
};

/** 預設學科：未指定 subjectId 時使用（維持既有流程完全不變） */
export const DEFAULT_SUBJECT_ID = 'cpp';

/** 註冊表：新增學科在此加一行 */
const SUBJECTS = new Map<string, Subject>([
  [cppSubject.id, cppSubject],
  [pythonSubject.id, pythonSubject],
  [calculusSubject.id, calculusSubject],
]);

/** 依 subjectId 取得學科設定；不存在時列出可用學科方便除錯 */
export function getSubject(subjectId: string): Subject {
  const subject = SUBJECTS.get(subjectId);
  if (!subject) {
    throw new Error(
      `學科不存在：${subjectId}（可用學科：${[...SUBJECTS.keys()].join('、')}）`,
    );
  }
  return subject;
}

/** 列出所有已註冊學科（教師端選單／跨學科報表用） */
export function listSubjects(): Subject[] {
  return [...SUBJECTS.values()];
}
