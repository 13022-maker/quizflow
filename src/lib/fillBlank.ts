/**
 * 填空題（AI 出題的 fill → 存成 short_answer，body 用 ___ 標空格）共用工具。
 *
 * 背景：填空題在 DB 沒有獨立題型，跟簡答題共用 short_answer；正解存在
 * correctAnswers[0]（一個字串），多格時 AI 通常回「葉綠體、二氧化碳」這種用頓號
 * 等分隔的單一字串。學生端原本只有一個 textarea，二格以上的題目得把答案擠在一起。
 *
 * 這裡提供：
 * - 空格偵測 / 計數（略過 ``` 程式碼區塊，避免程式碼裡的底線被誤判）
 * - 題幹空格編號（___ → ___(1)___），讓學生知道哪一格對應哪個輸入框
 * - 學生多格作答 → 單一字串（送給既有的簡答 AI 批改，不改 DB / 批改格式）
 * - 正解字串依空格數拆開（給靜態填空練習頁逐格比對用）
 *
 * 單一空格 / 沒有空格的題目一律不走這裡的多格流程，行為跟原本完全一樣。
 */

// 空格標記：3 個以上半形底線、2 個以上全形底線、或只含空白（含全形空白）的全形括號
const BLANK_MARKER_SOURCE = '_{3,}|＿{2,}|（[ \\t\\u3000]*）';

const FENCE_REGEX = /```[\s\S]*?(?:```|$)/g;

type BodyPart = { code: boolean; text: string };

/** 把題幹切成「一般文字 / ``` 程式碼區塊」交錯片段，只有一般文字會偵測空格 */
function splitByCodeFence(body: string): BodyPart[] {
  const parts: BodyPart[] = [];
  let last = 0;
  for (const m of body.matchAll(FENCE_REGEX)) {
    const start = m.index ?? 0;
    if (start > last) {
      parts.push({ code: false, text: body.slice(last, start) });
    }
    parts.push({ code: true, text: m[0] });
    last = start + m[0].length;
  }
  if (last < body.length) {
    parts.push({ code: false, text: body.slice(last) });
  }
  return parts;
}

/** 題幹中的空格數（程式碼區塊內的底線不算） */
export function countBlanks(body: string | null | undefined): number {
  if (!body) {
    return 0;
  }
  return splitByCodeFence(body)
    .filter(p => !p.code)
    .reduce((sum, p) => sum + (p.text.match(new RegExp(BLANK_MARKER_SOURCE, 'g'))?.length ?? 0), 0);
}

/**
 * 學生作答時要顯示幾個輸入框：題型是 short_answer 且題幹有 2 個以上空格才回傳空格數，
 * 其他情況回傳 0（代表沿用原本單一 textarea，不改變既有行為）。
 */
export function getMultiBlankCount(question: { type: string; body: string | null | undefined }): number {
  if (question.type !== 'short_answer') {
    return 0;
  }
  const n = countBlanks(question.body);
  return n >= 2 ? n : 0;
}

/** 把題幹每個空格標上編號：「___」→「___(1)___」，對應作答區的第 1 格輸入框 */
export function numberBlanks(body: string): string {
  let n = 0;
  return splitByCodeFence(body)
    .map(p => (p.code
      ? p.text
      : p.text.replace(new RegExp(BLANK_MARKER_SOURCE, 'g'), () => {
        n += 1;
        return `___(${n})___`;
      })))
    .join('');
}

/** 依空格切開題幹：回傳 N+1 段文字（第 i 個空格在 segments[i] 與 segments[i+1] 之間） */
export function splitBodyByBlanks(body: string): string[] {
  const segments: string[] = [];
  let current = '';
  for (const p of splitByCodeFence(body)) {
    if (p.code) {
      current += p.text;
      continue;
    }
    const pieces = p.text.split(new RegExp(BLANK_MARKER_SOURCE));
    current += pieces[0] ?? '';
    for (let i = 1; i < pieces.length; i++) {
      segments.push(current);
      current = pieces[i] ?? '';
    }
  }
  segments.push(current);
  return segments;
}

const EMPTY_BLANK_TEXT = '（空白）';

/**
 * 多格作答 → 單一字串，格式「(1) 葉綠體；(2) 二氧化碳」。
 * 送出時轉成這個字串，後端簡答 AI 批改、DB answer 欄位、老師成績頁都不用改格式。
 * 全部空白時回傳空字串，讓 AI 批改走既有的「交白卷」判定。
 */
export function joinBlankAnswers(parts: readonly string[]): string {
  if (parts.every(p => p.trim() === '')) {
    return '';
  }
  return parts
    .map((p, i) => `(${i + 1}) ${p.trim() || EMPTY_BLANK_TEXT}`)
    .join('；');
}

// 依序嘗試的正解分隔符（越不容易出現在答案本身的越前面）
const ANSWER_DELIMITERS: RegExp[] = [
  /\s*[|｜]\s*/,
  /\s*[;；]\s*/,
  /\s*、\s*/,
  /\s*[,，]\s*/,
  /\s*[/／]\s*/,
  /\s+/,
];

// 答案開頭的編號：(1) （1） 1. 1、 ① 等
// eslint-disable-next-line regexp/no-obscure-range -- ①-⑳ 是圈號數字（U+2460–U+2473），刻意整段比對
const ENUM_PREFIX = /^(?:[(（]\s*\d+\s*[)）]|\d+\s*[.、．:：]|[①-⑳])\s*/;
// eslint-disable-next-line regexp/no-obscure-range -- ①-⑳ 是圈號數字（U+2460–U+2473），刻意整段比對
const ENUM_SPLIT = /\s*(?:[(（]\s*\d+\s*[)）]|[①-⑳])\s*/;

function cleanPart(s: string): string {
  return s.trim().replace(ENUM_PREFIX, '').trim();
}

/**
 * 把單一正解字串依空格數拆成 n 份；拆不出剛好 n 份非空答案就回傳 null。
 * 例：splitAnswerParts('葉綠體、二氧化碳', 2) → ['葉綠體', '二氧化碳']
 */
export function splitAnswerParts(answer: string, n: number): string[] | null {
  const trimmed = answer.trim();
  if (n <= 0 || !trimmed) {
    return null;
  }
  if (n === 1) {
    return [trimmed];
  }
  // 先試「(1) 甲 (2) 乙」/「①甲②乙」這種編號格式
  const enumParts = trimmed.split(ENUM_SPLIT).map(s => s.replace(/[;；,，、]\s*$/, '').trim()).filter(Boolean);
  if (enumParts.length === n && ENUM_SPLIT.test(trimmed)) {
    return enumParts;
  }
  for (const delim of ANSWER_DELIMITERS) {
    const parts = trimmed.split(delim).map(cleanPart);
    if (parts.length === n && parts.every(Boolean)) {
      return parts;
    }
  }
  return null;
}

/**
 * 取得每一格的正解：correctAnswers 已經是 n 筆就直接用，只有 1 筆就嘗試拆開；
 * 對不上空格數回傳 null（呼叫端自行決定 fallback）。
 */
export function resolveBlankAnswers(correctAnswers: readonly string[] | null | undefined, n: number): string[] | null {
  const list = (correctAnswers ?? []).map(s => s.trim()).filter(Boolean);
  if (n <= 0 || list.length === 0) {
    return null;
  }
  if (list.length === n) {
    return list;
  }
  if (list.length === 1) {
    return splitAnswerParts(list[0]!, n);
  }
  return null;
}
