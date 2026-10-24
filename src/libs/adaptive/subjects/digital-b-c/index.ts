/**
 * 學科設定：數位電子乙級 學科 C 語言（勞動部數位電子乙級學科題庫 79 題）
 * - 8 個主題學科（dzb-c-*）：每科 2–3 個知識點，線性前置鏈
 * - 1 個總複習學科（dzb-c-all）：串接所有主題的知識點，涵蓋全部 79 題
 * 題庫與知識圖譜由 scripts/generate-digital-b-c-subjects.ts 產生在 data.ts；
 * 本檔只負責組裝成 Subject。subjectId 已被練習資料引用，不可更改。
 */

import type { Subject, TutorProfile } from '../index';
import { DZB_ALL_META, DZB_CATEGORY, DZB_TOPIC_DATA } from './data';

/** 導師提示詞：題目以標準 C（gcc、x86-64 little-endian）為準 */
const tutor: TutorProfile = {
  lessonExampleRule: '必須含至少一段可用 gcc 編譯執行的標準 C 程式碼範例，並逐步追蹤變數值或位元變化',
  formatRule: '程式碼註解一律使用繁體中文；以標準 C（gcc、x86-64、little-endian）為準，不使用 C++ 語法',
};

/** 8 個主題學科（順序 = 學科選單順序） */
export const DZB_TOPIC_SUBJECTS: Subject[] = DZB_TOPIC_DATA.map(data => ({
  id: data.id,
  name: data.name,
  category: DZB_CATEGORY,
  description: data.description,
  graph: { nodes: data.nodes },
  itemBank: { items: data.items },
  tutor,
}));

export const DZB_ALL_SUBJECT_ID = DZB_ALL_META.id;

/**
 * 總複習學科：所有主題的知識點依主題順序串成一條學習路徑——
 * 每個主題的起點知識點以前一主題的最後一個知識點為前置，
 * 學生依序精熟一個主題後才進到下一個主題。
 */
const allSubject: Subject = {
  id: DZB_ALL_META.id,
  name: DZB_ALL_META.name,
  category: DZB_CATEGORY,
  description: DZB_ALL_META.description,
  graph: {
    nodes: DZB_TOPIC_DATA.flatMap((data, i) => {
      const prevLast = i > 0 ? DZB_TOPIC_DATA[i - 1]!.nodes.at(-1)!.id : undefined;
      return data.nodes.map(node => ({
        ...node,
        prerequisites: node.prerequisites.length === 0 && prevLast ? [prevLast] : [...node.prerequisites],
      }));
    }),
  },
  itemBank: { items: DZB_TOPIC_DATA.flatMap(data => data.items) },
  tutor,
};

/** 所有數位乙級學科（8 個主題＋總複習，依註冊順序） */
export const DZB_SUBJECTS: Subject[] = [...DZB_TOPIC_SUBJECTS, allSubject];
