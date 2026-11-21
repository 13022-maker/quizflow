/**
 * 產生「數位電子乙級 C 語言」適性學習內建學科
 *
 * 來源：scripts/data/digital-b-c-bank.json（79 題，已 gcc 驗算）
 * 輸出：src/libs/adaptive/subjects/digital-b-c/data.ts（題庫＋知識圖譜，自動產生，請勿手改）
 *
 * 用法（可重跑，輸出為決定性結果）：
 *   node scripts/generate-digital-b-c-subjects.ts      （Node 22.18+ 原生支援 type stripping）
 *   npx eslint --fix src/libs/adaptive/subjects/digital-b-c
 *
 * 轉換規則：
 *   - 單選：prompt = 題幹（有程式碼時接 ```c 區塊）；answerIndex = answer[0] - 1；
 *     解析中的 ①②③④ 換成前端顯示的 (A)(B)(C)(D)
 *   - 複選：轉「組合選項單選」——題幹列出 ①～④ 敘述，選項為 4 個固定組合
 *     （正解＋少一個／多一個／換一個 三種干擾），依（個數, 字典序）排序後
 *     旋轉使正解落在 題號 % 4，避免正解位置集中
 *   - note 以「⚠️」開頭接在解析後
 *   - 難度：1/2/3 各對應一段區間，同一知識點內同難度的題目依題號平均分散
 *
 * 知識點切分與主題合併的教學設計寫在下方 CURRICULUM（改這裡再重跑即可）。
 * 注意：subjectId 與知識點 id 已被練習資料引用，上線後不可再改。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type BankQuestion = {
  id: string;
  no: number;
  type: 'single' | 'multiple';
  topic: string;
  stem: string;
  code: string | null;
  options: string[];
  answer: number[];
  explanation: string;
  difficulty: 1 | 2 | 3;
  note: string | null;
};

type Bank = {
  topics: Record<string, string>;
  questions: BankQuestion[];
};

type NodeSpec = {
  id: string;
  name: string;
  prerequisites: string[];
  questionNos: number[];
};

type SubjectSpec = {
  id: string;
  name: string;
  description: string;
  topics: string[]; // 涵蓋的題庫 topic 代碼（合併主題時有多個）
  nodes: NodeSpec[];
};

// ============================================================================
// 教學設計：每個主題學科 2–4 個知識點，每個知識點至少 3 題（引擎實務最低需求）
// 學科陣列順序 = 學科選單順序 = 總複習學科的學習路徑順序
// ============================================================================
const CURRICULUM: SubjectSpec[] = [
  {
    id: 'dzb-c-type',
    name: '數位乙級｜資料型態、宣告與字串',
    description: '識別字、關鍵字、printf、sizeof；陷阱：字串結尾 \\0、溢位',
    topics: ['TYPE'],
    nodes: [
      { id: 'dzb-type-decl', name: '識別字、關鍵字與變數宣告', prerequisites: [], questionNos: [8, 45, 46, 50, 67] },
      { id: 'dzb-type-io', name: 'printf 格式與 sizeof', prerequisites: ['dzb-type-decl'], questionNos: [47, 48, 49] },
      { id: 'dzb-type-str', name: '字串結尾與整數範圍溢位', prerequisites: ['dzb-type-io'], questionNos: [24, 25, 73] },
    ],
  },
  {
    id: 'dzb-c-opr',
    name: '數位乙級｜運算子與型態轉換',
    description: '算術、關係邏輯、?: 與隱式轉型；陷阱：y++ 先用後加、優先順序',
    topics: ['OPR'],
    nodes: [
      { id: 'dzb-opr-arith', name: '算術、取餘與遞增遞減', prerequisites: [], questionNos: [17, 19, 33, 80] },
      { id: 'dzb-opr-logic', name: '關係、邏輯運算與真假值', prerequisites: ['dzb-opr-arith'], questionNos: [13, 27, 30, 37, 72] },
      { id: 'dzb-opr-cast', name: '型態轉換與條件運算子', prerequisites: ['dzb-opr-logic'], questionNos: [20, 36, 68] },
    ],
  },
  {
    id: 'dzb-c-flow',
    name: '數位乙級｜流程控制（迴圈、switch、break）',
    description: '追蹤迴圈次數與 switch 貫穿；陷阱：do…while、漏 break',
    topics: ['FLOW'],
    nodes: [
      { id: 'dzb-flow-loop', name: '迴圈結構與執行次數', prerequisites: [], questionNos: [11, 12, 14, 16, 28] },
      { id: 'dzb-flow-jump', name: 'switch、break 與無窮迴圈', prerequisites: ['dzb-flow-loop'], questionNos: [15, 29, 53, 70] },
    ],
  },
  {
    id: 'dzb-c-bit',
    name: '數位乙級｜位元運算與進位制',
    description: '八／十六進位與位元運算；陷阱：前導 0 是八進位、8 位元截斷',
    topics: ['BIT'],
    nodes: [
      { id: 'dzb-bit-radix', name: '進位制與整數常數', prerequisites: [], questionNos: [7, 9, 31] },
      { id: 'dzb-bit-ops', name: '位元運算與移位', prerequisites: ['dzb-bit-radix'], questionNos: [34, 64, 65, 66] },
    ],
  },
  {
    id: 'dzb-c-func',
    name: '數位乙級｜函式、巨集與參數傳遞',
    description: '傳值呼叫與巨集展開；陷阱：swap 傳值無效、巨集參數被求值兩次',
    topics: ['FUNC'],
    nodes: [
      { id: 'dzb-func-call', name: '函式呼叫與傳值', prerequisites: [], questionNos: [18, 21, 26] },
      { id: 'dzb-func-macro', name: '巨集與副程式比較', prerequisites: ['dzb-func-call'], questionNos: [2, 4, 22] },
    ],
  },
  {
    id: 'dzb-c-ptr',
    name: '數位乙級｜指標與陣列',
    description: '陣列索引、取址解參考與指標轉型；陷阱：索引從 0、endian 位元組順序',
    topics: ['PTR'],
    nodes: [
      { id: 'dzb-ptr-array', name: '陣列宣告與索引', prerequisites: [], questionNos: [10, 35, 51, 52] },
      { id: 'dzb-ptr-deref', name: '指標取址與解參考', prerequisites: ['dzb-ptr-array'], questionNos: [54, 58, 59, 60, 74] },
      { id: 'dzb-ptr-cast', name: '指標轉型、endian 與字串複製', prerequisites: ['dzb-ptr-deref'], questionNos: [57, 61, 62] },
    ],
  },
  {
    // 合併：STRUCT（4 題）無法獨立成科（2 個知識點 × 3 題 = 至少 6 題），
    // 其 sizeof／對齊／union 共用記憶體本質是「記憶體配置」，併入 MEM
    id: 'dzb-c-mem',
    name: '數位乙級｜記憶體配置與結構（struct／union）',
    description: '記憶體區段、生命週期與 struct 對齊；陷阱：padding、union',
    topics: ['MEM', 'STRUCT'],
    nodes: [
      { id: 'dzb-mem-segment', name: '記憶體區段與動態配置', prerequisites: [], questionNos: [40, 41, 56, 77] },
      { id: 'dzb-mem-scope', name: '變數範圍與生命週期', prerequisites: ['dzb-mem-segment'], questionNos: [32, 69, 71] },
      { id: 'dzb-mem-struct', name: '結構、union 與記憶體對齊', prerequisites: ['dzb-mem-scope'], questionNos: [55, 63, 75, 76] },
    ],
  },
  {
    // 合併：ARCH（2 題）連單一知識點都不夠 3 題，併入 CMP 的「嵌入式／硬體」知識點
    id: 'dzb-c-cmp',
    name: '數位乙級｜編譯流程與計算機組織',
    description: 'gcc 編譯四階段、嵌入式 C 與旗標／BCD；陷阱：前置處理先於編譯',
    topics: ['CMP', 'ARCH'],
    nodes: [
      { id: 'dzb-cmp-tools', name: '編譯器、直譯器與 gcc', prerequisites: [], questionNos: [23, 38, 39] },
      { id: 'dzb-cmp-stages', name: '編譯四階段與連結', prerequisites: ['dzb-cmp-tools'], questionNos: [5, 42, 43, 44] },
      { id: 'dzb-cmp-embedded', name: '嵌入式 C 與 CPU 硬體概念', prerequisites: ['dzb-cmp-stages'], questionNos: [3, 6, 78, 79] },
    ],
  },
];

const ALL_SUBJECT = {
  id: 'dzb-c-all',
  name: '數位乙級｜C語言總複習（全 79 題）',
  description: '79 題全主題混合，依學習路徑逐點精熟；適合考前總複習與弱點掃描',
};

const CATEGORY = '數位乙級 C語言';

/** 難度區間：題庫 1/2/3 → 引擎 0.1~1.0 光譜的三段 */
const DIFFICULTY_BANDS: Record<1 | 2 | 3, [number, number]> = {
  1: [0.1, 0.35],
  2: [0.4, 0.65],
  3: [0.7, 1.0],
};

const CIRCLED = ['①', '②', '③', '④'];
const LETTERS = ['(A)', '(B)', '(C)', '(D)'];

// ============================================================================
// 轉換工具
// ============================================================================

/**
 * 跳脫 Markdown 特殊字元（題幹、解析經 marked 渲染）。
 * 只跳脫「行內會被誤判」的最小集合，避免 AI 提示詞、Live 快照等純文字用途出現過多反斜線：
 *   星號與底線 → 強調（5*3>4*3、*y 與 *z 成對會變斜體）；反引號 → 行內程式碼；
 *   < → 可能被當成 HTML 標籤；~ → 刪除線（1~6）；
 *   \ 只在後面接 ASCII 標點時跳脫（'\0'、"\n" 原樣保留）
 */
function escapeMarkdown(text: string): string {
  return text
    .replace(/\\(?=[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '\\\\')
    .replace(/[`*_<~]/g, ch => `\\${ch}`);
}

function codeBlock(code: string): string {
  return `\`\`\`c\n${code.replace(/\s+$/, '')}\n\`\`\``;
}

/** 單選題解析／警語裡的 ①～④ 指的是選項，換成前端顯示的 (A)～(D) */
function circledToLetters(text: string): string {
  return text.replace(/[①②③④]/g, ch => LETTERS[CIRCLED.indexOf(ch)]!);
}

function comboLabel(indices: number[]): string {
  return [...indices].sort((a, b) => a - b).map(i => CIRCLED[i - 1]).join('');
}

/**
 * 複選題 → 4 個固定組合選項（正解＋3 個干擾）
 * 干擾優先序：少最後一個 → 多最小的錯誤敘述 → 最後一個換成最小錯誤敘述，
 * 不足時再補其他合理組合；保證互不相同且非空。
 */
function buildCombos(q: BankQuestion): { options: string[]; answerIndex: number } {
  const correct = [...q.answer].sort((a, b) => a - b);
  const wrong = [1, 2, 3, 4].filter(i => !correct.includes(i));
  const candidates: number[][] = [];
  if (correct.length >= 2) {
    candidates.push(correct.slice(0, -1));
  }
  if (wrong.length >= 1) {
    candidates.push([...correct, wrong[0]!]);
    candidates.push([...correct.slice(0, -1), wrong[0]!]);
  }
  if (correct.length >= 2) {
    candidates.push(correct.slice(1));
  }
  if (wrong.length >= 1) {
    candidates.push([...correct.slice(1), wrong[0]!]);
  }
  if (wrong.length >= 2) {
    candidates.push([...correct, wrong[1]!]);
    candidates.push([...correct.slice(0, -1), wrong[1]!]);
  }
  candidates.push(wrong, [1, 2, 3, 4]);

  const answerLabel = comboLabel(correct);
  const labels: string[] = [answerLabel];
  for (const c of candidates) {
    const label = comboLabel(c);
    if (c.length > 0 && !labels.includes(label)) {
      labels.push(label);
    }
    if (labels.length === 4) {
      break;
    }
  }
  if (labels.length !== 4) {
    throw new Error(`${q.id} 無法產生 4 個相異組合`);
  }

  const sorted = [...labels].sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  const target = q.no % 4;
  const shift = (target - sorted.indexOf(answerLabel) + 4) % 4;
  const options: string[] = Array.from({ length: 4 });
  sorted.forEach((label, i) => {
    options[(i + shift) % 4] = label;
  });
  return { options, answerIndex: options.indexOf(answerLabel) };
}

type OutItem = {
  id: string;
  knowledgeId: string;
  difficulty: number;
  prompt: string;
  options: string[];
  answerIndex: number;
  explanation: string;
};

function convertQuestion(q: BankQuestion, knowledgeId: string, difficulty: number): OutItem {
  const parts = [escapeMarkdown(q.stem.trim())];
  if (q.code) {
    parts.push(codeBlock(q.code));
  }

  let options: string[];
  let answerIndex: number;
  let explanation: string;
  let note = q.note;

  if (q.type === 'single') {
    if (q.answer.length !== 1) {
      throw new Error(`${q.id} 單選題答案數量不是 1`);
    }
    options = [...q.options];
    answerIndex = q.answer[0]! - 1;
    explanation = escapeMarkdown(circledToLetters(q.explanation));
    note = note ? circledToLetters(note) : null;
  } else {
    // 複選題：題幹列出敘述（空行分段，marked 才不會併成一行）
    parts.push(...q.options.map((opt, i) => `${CIRCLED[i]} ${escapeMarkdown(opt)}`));
    parts.push('（原為複選題）請選出「所有符合題意的敘述」的完整組合：');
    ({ options, answerIndex } = buildCombos(q));
    explanation = `${escapeMarkdown(q.explanation)}\n\n正解組合：${comboLabel(q.answer)}`;
  }
  if (note) {
    explanation += `\n\n⚠️ ${escapeMarkdown(note)}`;
  }

  if (options.length !== 4 || new Set(options).size !== 4) {
    throw new Error(`${q.id} 選項不是 4 個相異值`);
  }
  if (answerIndex < 0 || answerIndex > 3) {
    throw new Error(`${q.id} answerIndex 超出範圍`);
  }

  return {
    id: `DZB-Q${q.no}`,
    knowledgeId,
    difficulty,
    prompt: parts.join('\n\n'),
    options,
    answerIndex,
    explanation,
  };
}

/** 同一知識點內、同一難度等級的題目依題號在區間內平均分散（單題取區間中點） */
function assignDifficulties(questions: BankQuestion[]): Map<number, number> {
  const result = new Map<number, number>();
  for (const level of [1, 2, 3] as const) {
    const group = questions.filter(q => q.difficulty === level).sort((a, b) => a.no - b.no);
    const [lo, hi] = DIFFICULTY_BANDS[level];
    group.forEach((q, i) => {
      const value = group.length === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * i) / (group.length - 1);
      result.set(q.no, Math.round(value * 100) / 100);
    });
  }
  return result;
}

// ============================================================================
// TypeScript 輸出（直接產生符合 antfu 風格的程式碼：單引號、尾逗號、分號）
// ============================================================================

function tsString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/\n/g, '\\n')}'`;
}

function tsStringArray(values: string[], indent: string): string {
  return `[\n${values.map(v => `${indent}  ${tsString(v)},`).join('\n')}\n${indent}]`;
}

function renderItem(item: OutItem, indent: string): string {
  const i2 = `${indent}  `;
  return [
    `${indent}{`,
    `${i2}id: ${tsString(item.id)},`,
    `${i2}knowledgeId: ${tsString(item.knowledgeId)},`,
    `${i2}difficulty: ${item.difficulty},`,
    `${i2}prompt: ${tsString(item.prompt)},`,
    `${i2}options: ${tsStringArray(item.options, i2)},`,
    `${i2}answerIndex: ${item.answerIndex},`,
    `${i2}explanation: ${tsString(item.explanation)},`,
    `${indent}},`,
  ].join('\n');
}

function renderNode(node: NodeSpec, indent: string): string {
  const prereqs = node.prerequisites.length === 0
    ? '[]'
    : `[${node.prerequisites.map(tsString).join(', ')}]`;
  return `${indent}{ id: ${tsString(node.id)}, name: ${tsString(node.name)}, prerequisites: ${prereqs} },`;
}

function main(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const bank = JSON.parse(
    readFileSync(resolve(root, 'scripts/data/digital-b-c-bank.json'), 'utf8'),
  ) as Bank;
  const byNo = new Map(bank.questions.map(q => [q.no, q]));

  // --- 驗證 CURRICULUM：每題恰好分配一次、topic 對應正確、知識點題數足夠 ---
  const assigned = new Set<number>();
  for (const subject of CURRICULUM) {
    for (const node of subject.nodes) {
      if (node.questionNos.length < 3) {
        throw new Error(`${node.id} 只有 ${node.questionNos.length} 題，低於引擎最低需求 3 題`);
      }
      for (const no of node.questionNos) {
        const q = byNo.get(no);
        if (!q) {
          throw new Error(`題庫沒有第 ${no} 題`);
        }
        if (!subject.topics.includes(q.topic)) {
          throw new Error(`第 ${no} 題 topic=${q.topic} 不屬於 ${subject.id}`);
        }
        if (assigned.has(no)) {
          throw new Error(`第 ${no} 題被重複分配`);
        }
        assigned.add(no);
      }
    }
  }
  const missing = bank.questions.filter(q => !assigned.has(q.no)).map(q => q.no);
  if (missing.length > 0) {
    throw new Error(`下列題號未分配到任何知識點：${missing.join(', ')}`);
  }

  const lines: string[] = [
    '/**',
    ' * 此檔由 scripts/generate-digital-b-c-subjects.ts 產生，請勿手改。',
    ' * 來源：scripts/data/digital-b-c-bank.json（數位電子乙級學科 C 語言 79 題）',
    ' * 重新產生：node scripts/generate-digital-b-c-subjects.ts && npx eslint --fix src/libs/adaptive/subjects/digital-b-c',
    ' */',
    '',
    'import type { Item, KnowledgeNode } from \'../../engine\';',
    '',
    '/** 主題學科定義（id、名稱、說明、知識點、題目） */',
    'export type DzbTopicSubjectData = {',
    '  id: string;',
    '  name: string;',
    '  description: string;',
    '  nodes: KnowledgeNode[];',
    '  items: Item[];',
    '};',
    '',
    `export const DZB_CATEGORY = ${tsString(CATEGORY)};`,
    '',
    `export const DZB_ALL_META = {`,
    `  id: ${tsString(ALL_SUBJECT.id)},`,
    `  name: ${tsString(ALL_SUBJECT.name)},`,
    `  description: ${tsString(ALL_SUBJECT.description)},`,
    '} as const;',
    '',
    'export const DZB_TOPIC_DATA: DzbTopicSubjectData[] = [',
  ];

  for (const subject of CURRICULUM) {
    lines.push('  {');
    lines.push(`    id: ${tsString(subject.id)},`);
    lines.push(`    name: ${tsString(subject.name)},`);
    lines.push(`    description: ${tsString(subject.description)},`);
    lines.push('    nodes: [');
    subject.nodes.forEach(node => lines.push(renderNode(node, '      ')));
    lines.push('    ],');
    lines.push('    items: [');
    for (const node of subject.nodes) {
      const qs = node.questionNos.map(no => byNo.get(no)!).sort((a, b) => a.no - b.no);
      const difficulties = assignDifficulties(qs);
      lines.push(`      // --- ${node.name} ---`);
      for (const q of qs) {
        lines.push(renderItem(convertQuestion(q, node.id, difficulties.get(q.no)!), '      '));
      }
    }
    lines.push('    ],');
    lines.push('  },');
  }
  lines.push('];', '');

  const outPath = resolve(root, 'src/libs/adaptive/subjects/digital-b-c/data.ts');
  writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.warn(`✅ 已產生 ${outPath}（${CURRICULUM.length} 個主題學科、${assigned.size} 題）`);
}

main();
