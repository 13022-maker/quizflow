/**
 * 答案正規化工具
 *
 * AI 回傳的正解寫法五花八門（「(C)」「Ｃ」「答案：C」「〇」「對」…），
 * 匯入時若比對失敗就會默默存成錯誤正解或空正解，學生答對反而被扣分。
 * 所有「AI 回傳 → 存進 DB」的轉存點都應該經過這裡，不要各自手寫比對。
 */
import { stripOptionLabel } from '@/lib/ai/optionText';

type Option = { id: string; text: string };

/** 自由文字比對用：全形轉半形（NFKC）、去頭尾空白、轉小寫 */
export function normalizeFreeText(v: string): string {
  return v.normalize('NFKC').trim().toLocaleLowerCase();
}

// 「答案：」「Ans:」之類的前綴
const ANSWER_PREFIX_RE = /^(?:正確答案|答案|解答|ans(?:wer)?)(?:\s*[:：])?\s*/i;
// 單一字母答案：A / (A) / （A） / A. / A、 / A)
const LETTER_ONLY_RE = /^[(（[]?\s*([a-z])\s*[)）\]]?[.．、:：)]?$/i;
// 括號字母開頭再接選項文字：(C) 細胞核
const LETTER_PREFIX_RE = /^[(（[]\s*([a-z])\s*[)）\]]/i;

/**
 * 選擇題正解比對：把 AI 的 answer 對到 option id。
 * 先試字母（含括號、全形、「答案：」前綴），再試選項文字。
 * 對不到時回傳 null —— 寧可留空讓老師補，也不要默默存成錯的正解。
 */
export function matchChoiceAnswerId(options: Option[], answer: unknown): string | null {
  if (typeof answer !== 'string') {
    return null;
  }
  const s = answer.normalize('NFKC').trim().replace(ANSWER_PREFIX_RE, '').trim();
  if (!s) {
    return null;
  }

  const letterFromIndex = (letter: string): string | null => {
    const idx = letter.toLowerCase().charCodeAt(0) - 97;
    return options[idx]?.id ?? null;
  };

  const letterOnly = s.match(LETTER_ONLY_RE);
  if (letterOnly) {
    return letterFromIndex(letterOnly[1]!);
  }

  const target = normalizeFreeText(stripOptionLabel(s));
  const byText = options.find(o => normalizeFreeText(stripOptionLabel(o.text)) === target);
  if (byText) {
    return byText.id;
  }

  const letterPrefix = s.match(LETTER_PREFIX_RE);
  if (letterPrefix) {
    return letterFromIndex(letterPrefix[1]!);
  }

  return null;
}

const TRUE_SET = new Set(['○', '〇', '◯', 'o', '正確', '對', '是', '真', 'true', 't', 'yes', 'y', '✓', '✔', '√']);
const FALSE_SET = new Set(['✕', '✗', '✘', '×', 'x', '錯誤', '錯', '否', '非', '假', 'false', 'f', 'no', 'n']);

/**
 * 是非題正解：AI 的各種寫法 → 'tf-true' / 'tf-false'。
 * 認不得時回傳 null，不要默默當成「錯誤」。
 */
export function parseTrueFalseAnswer(answer: unknown): 'tf-true' | 'tf-false' | null {
  if (typeof answer === 'boolean') {
    return answer ? 'tf-true' : 'tf-false';
  }
  if (typeof answer !== 'string') {
    return null;
  }
  const s = normalizeFreeText(answer).replace(ANSWER_PREFIX_RE, '').trim();
  if (TRUE_SET.has(s)) {
    return 'tf-true';
  }
  if (FALSE_SET.has(s)) {
    return 'tf-false';
  }
  return null;
}

/**
 * 排序題：把 options 依 correctAnswers 重排，讓「由上到下」就是正解。
 * 老師編輯器把 options 陣列順序當正解顯示、存檔時也照它覆寫 correctAnswers，
 * 所以 options 與 correctAnswers 必須同序。correctAnswers 不完整時原樣返回。
 */
export function orderRankingOptions<T extends Option>(options: T[], correctAnswers: string[] | null | undefined): T[] {
  if (!correctAnswers || correctAnswers.length !== options.length) {
    return options;
  }
  const ordered = correctAnswers.map(id => options.find(o => o.id === id));
  if (ordered.some(o => !o) || new Set(correctAnswers).size !== options.length) {
    return options;
  }
  return ordered as T[];
}

/**
 * 簡答 / 填空 AI 評分的參考答案：老師填的 referenceAnswer 優先，
 * 沒有時退回 correctAnswers[0]（AI 匯入的填充題答案存在這裡）。
 */
export function resolveShortAnswerReference(q: {
  referenceAnswer: string | null;
  correctAnswers: string[] | null;
}): string | null {
  if (q.referenceAnswer) {
    return q.referenceAnswer;
  }
  return q.correctAnswers?.[0] || null;
}

/**
 * 排序題列印順序：以 seed（題目 id）固定打亂，同一題每次印出相同順序，
 * 且保證不等於正解順序（DB 的 options 已是正解順序，原樣印出等於洩題）。
 */
export function printOrderForRanking<T>(options: T[], seed: number): T[] {
  if (options.length < 2) {
    return [...options];
  }
  // mulberry32：小而穩定的種子亂數
  let t = (seed >>> 0) + 0x6D2B79F5;
  const rand = () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...options];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  // 洗完剛好跟原順序一樣時整體平移一格
  if (out.every((o, i) => o === options[i])) {
    out.push(out.shift()!);
  }
  return out;
}
