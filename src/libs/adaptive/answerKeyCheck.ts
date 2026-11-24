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
import { needsCodeSnippet, parseCodeBlocks, referencesCode } from '@/lib/codeBlock';

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

/**
 * 取出題幹中的 C/C++ 程式碼：優先取第一個 c/cpp 圍欄；
 * 沒有圍欄但題幹引用程式（舊題常見「1 int a; 2 for(...){ 3 ... }」行號擠成一行）時，
 * 去掉行號、每個陳述式換行後回傳。都不是就回傳 null。
 */
export function extractCppSnippet(prompt: string): string | null {
  const block = parseCodeBlocks(prompt).find(
    seg => seg.kind === 'code' && CPP_LANGS.has(seg.lang.toLowerCase()),
  );
  if (block && block.kind === 'code') {
    return block.code;
  }
  return extractInlineNumberedCode(prompt);
}

/** 行號擠成一行的舊題：改寫成「題目＋```cpp 圍欄」；不需要修就回傳 null */
export function repairInlineCodePrompt(prompt: string): string | null {
  const code = extractInlineNumberedCode(prompt);
  if (!code) {
    return null;
  }
  const stem = prompt.slice(0, /[？?]\s*1\s+\S/.exec(prompt)!.index + 1).trim();
  return `${stem}\n\`\`\`cpp\n${code}\n\`\`\``;
}

function extractInlineNumberedCode(prompt: string): string | null {
  if (!needsCodeSnippet(prompt) || !referencesCode(prompt)) {
    return null;
  }
  // 題幹與程式碼的分界：第一個問號之後、且以行號「1 」開頭
  const match = /[？?]\s*1\s+(\S[\s\S]*)$/.exec(prompt);
  if (!match) {
    return null;
  }
  // 陳述式結尾（; { }）後面跟著的「數字＋空白」視為行號，換成換行
  const lines = match[1]!
    .replace(/([;{}])\s*\d+\s+/g, '$1\n')
    .replace(/;[ \t]*\}/g, ';\n}') // 「...; }」的右大括號獨立一行
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  if (!lines.some(line => line.includes(';'))) {
    return null;
  }
  // 依大括號深度補四格縮排
  let depth = 0;
  return lines
    .map((line) => {
      if (line.startsWith('}')) {
        depth = Math.max(0, depth - 1);
      }
      const indented = `${'    '.repeat(depth)}${line}`;
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length + (line.startsWith('}') ? 1 : 0);
      depth = Math.max(0, depth);
      return indented;
    })
    .join('\n');
}

/** 把程式片段包成可編譯的完整程式（已有 main 就只補 include）；epilogue 接在片段之後、return 之前 */
export function wrapCppProgram(snippet: string, epilogue = ''): string {
  const header = '#include <bits/stdc++.h>\nusing namespace std;\n';
  if (/\bmain\s*\(/.test(snippet)) {
    return `${header}${snippet}\n`;
  }
  return `${header}int main() {\n${snippet}\n${epilogue}return 0;\n}\n`;
}

export type StateAssertion = { lhs: string; rhs: string };

const ASSERT_MARKER = '__QF_ASSERT__';

/**
 * 「變數狀態」型選項（name[3]='y'、used[3] == 5）解析成左值與期望值；其他選項回傳 null。
 * 字串常值不解析：char 陣列用 == 比的是位址，會得到錯的結果。
 */
export function parseStateAssertion(option: string): StateAssertion | null {
  const m = /^\s*([A-Za-z_]\w*(?:\[\d+\])*)\s*={1,2}\s*(-?\d+(?:\.\d+)?|'(?:\\.|[^'\\])'|true|false)\s*$/.exec(normalize(option));
  return m ? { lhs: m[1]!, rhs: m[2]! } : null;
}

/** 在程式片段後逐一印出每個選項是否成立（標記行之後每行一個 0/1） */
export function buildAssertionProgram(snippet: string, assertions: StateAssertion[]): string {
  const checks = assertions
    .map(a => `cout << ((${a.lhs}) == (${a.rhs})) << "\\n";`)
    .join('\n');
  return wrapCppProgram(snippet, `cout << "\\n${ASSERT_MARKER}\\n";\n${checks}\n`);
}

/** 解析 buildAssertionProgram 的輸出；沒有標記（程式中途結束）回傳 null */
export function parseAssertionOutput(stdout: string): boolean[] | null {
  const idx = stdout.indexOf(ASSERT_MARKER);
  if (idx === -1) {
    return null;
  }
  return stdout
    .slice(idx + ASSERT_MARKER.length)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line === '1');
}

/** 題幹引用程式（「下列程式…」）卻沒附程式碼圍欄：回傳可回饋給模型的錯誤訊息 */
export function findCodeFormatProblems(items: { id: string; prompt: string }[]): string[] {
  return items
    .filter(item => needsCodeSnippet(item.prompt))
    .map(item => `題目 ${item.id} 的題幹引用程式碼，但沒有用 \`\`\`cpp 圍欄附上完整程式碼（不可把行號與程式擠在同一行）`);
}

/** 實際輸出對應到哪個選項（忽略頭尾與多重空白）；對不到回傳 -1 */
export function matchOutputToOption(stdout: string, options: string[]): number {
  const out = normalize(stdout);
  return options.findIndex(opt => normalize(opt) === out);
}
