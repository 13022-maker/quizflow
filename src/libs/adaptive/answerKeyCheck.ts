/**
 * 適性學習題庫的答案鍵檢查（純函式，前後端與 scripts 都可 import）
 *
 * 背景（bug）：AI 生成的 item-for-loop-step-005，解析逐步推導出 k=3，
 * answerIndex 卻指向「9」（把 j<6 當成 j<=6 的差一錯誤），學生選對反被判錯、精熟度被扣。
 * 既有驗證只檢查結構與知識圖譜，沒檢查「答案鍵 ↔ 解析」是否自洽。
 *
 * 兩層檢查：
 *   1. findExplanationKeyConflict：解析結論句提到的選項 ≠ 答案鍵 → 生成流程內擋下並重試（零成本）
 *   2. extractCppSnippet / wrapCppProgram / matchOutputToOption：給 scripts/audit-adaptive-answer-keys.ts
 *      真的編譯執行 C/C++ 程式輸出題，用實際輸出比對答案鍵（Vercel 沒有編譯器，只能離線跑）
 */
import { parseCodeBlocks } from '@/lib/codeBlock';

export type CheckableItem = {
  id: string;
  options: string[];
  answerIndex: number;
  explanation?: string;
};

export type ExplanationKeyConflict = {
  itemId: string;
  explanationIndex: number; // 解析結論指向的選項
  keyIndex: number; // answerIndex 指向的選項
};

/** 結論詞：取最後一個結論詞之後的文字當作「解析的結論」 */
const CONCLUSION_MARKERS = ['所以', '因此', '故', '最終', '最後', '答案是', '答案為', '輸出為', '輸出是', '結果為', '結果是'];
/** 否定／常見錯誤詞：結論中這些詞之後通常在講錯誤選項，截掉不看 */
const NEGATION_MARKERS = ['而非', '而不是', '不是', '並非', '不會是', '誤以為', '常見錯誤', '容易誤'];
/** 選項過長時解析不會逐字引用，不比對（避免誤判） */
const MAX_OPTION_LENGTH = 20;

function normalize(s: string): string {
  return s
    .normalize('NFKC') // 全形轉半形（Ｋ→K、３→3）
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 選項是否「以完整 token」出現在文字中（「13」不算提到「3」、「x2」不算提到「2」） */
function mentionsOption(text: string, option: string): boolean {
  const opt = normalize(option);
  if (!opt || opt.length > MAX_OPTION_LENGTH) {
    return false;
  }
  const pattern = new RegExp(`(?<![A-Za-z0-9_.])${escapeRegExp(opt)}(?![A-Za-z0-9_])`);
  return pattern.test(text);
}

/** 取出解析的結論片段；沒有結論詞就回傳 null（不判斷） */
function extractConclusion(explanation: string): string | null {
  const sentences = normalize(explanation)
    .split(/[。！？!?\n]/)
    .map(s => s.trim())
    .filter(Boolean);

  // 從最後一句往前找第一個含結論詞的句子
  for (let i = sentences.length - 1; i >= 0; i--) {
    const sentence = sentences[i]!;
    let cut = -1;
    let markerLength = 0;
    for (const marker of CONCLUSION_MARKERS) {
      const idx = sentence.lastIndexOf(marker);
      if (idx > cut) {
        cut = idx;
        markerLength = marker.length;
      }
    }
    if (cut === -1) {
      continue;
    }
    let conclusion = sentence.slice(cut + markerLength);
    for (const neg of NEGATION_MARKERS) {
      const idx = conclusion.indexOf(neg);
      if (idx !== -1) {
        conclusion = conclusion.slice(0, idx);
      }
    }
    return conclusion;
  }
  return null;
}

/**
 * 解析結論與答案鍵是否矛盾。保守判定：結論「恰好只提到一個選項」且不是答案鍵才回報，
 * 結論沒提到選項、提到多個、或沒有結論詞一律不判斷（寧可漏抓，不誤殺整份生成）。
 */
export function findExplanationKeyConflict(item: CheckableItem): ExplanationKeyConflict | null {
  if (!item.explanation) {
    return null;
  }
  const conclusion = extractConclusion(item.explanation);
  if (!conclusion) {
    return null;
  }
  const mentioned = item.options
    .map((opt, idx) => (mentionsOption(conclusion, opt) ? idx : -1))
    .filter(idx => idx !== -1);
  if (mentioned.length !== 1 || mentioned[0] === item.answerIndex) {
    return null;
  }
  return { itemId: item.id, explanationIndex: mentioned[0]!, keyIndex: item.answerIndex };
}

/** 全題庫檢查，回傳可直接回饋給模型重試的錯誤訊息 */
export function findAnswerKeyConflicts(items: CheckableItem[]): string[] {
  const messages: string[] = [];
  for (const item of items) {
    const conflict = findExplanationKeyConflict(item);
    if (conflict) {
      messages.push(
        `題目 ${item.id} 的解析結論是「${item.options[conflict.explanationIndex]}」，`
        + `但 answerIndex 指向「${item.options[conflict.keyIndex]}」。請重新逐步推導，讓答案鍵與解析一致`,
      );
    }
  }
  return messages;
}

const CPP_LANGS = new Set(['c', 'cpp', 'c++', 'cc', 'cxx']);

/** 取出題幹中的 C/C++ 程式碼（第一個 c/cpp 圍欄）；沒有就回傳 null */
export function extractCppSnippet(prompt: string): string | null {
  const block = parseCodeBlocks(prompt).find(
    seg => seg.kind === 'code' && CPP_LANGS.has(seg.lang.toLowerCase()),
  );
  return block && block.kind === 'code' ? block.code : null;
}

/** 把程式片段包成可編譯的完整程式（已有 main 就只補 include） */
export function wrapCppProgram(snippet: string): string {
  const header = '#include <bits/stdc++.h>\nusing namespace std;\n';
  if (/\bmain\s*\(/.test(snippet)) {
    return `${header}${snippet}\n`;
  }
  return `${header}int main() {\n${snippet}\nreturn 0;\n}\n`;
}

/** 實際輸出對應到哪個選項（忽略頭尾與多重空白）；對不到回傳 -1 */
export function matchOutputToOption(stdout: string, options: string[]): number {
  const out = normalize(stdout);
  return options.findIndex(opt => normalize(opt) === out);
}
