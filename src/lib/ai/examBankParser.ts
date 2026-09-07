/**
 * examBankParser.ts — 解析「題庫格式文字」成結構化題目(純函式,不碰 AI)
 *
 * 目標格式常見兩種寫法(兩種都支援,同一份文字混用也可以):
 *   格式 A(官方學科題庫常見):  1. (3) 題幹？①選項一②選項二③選項三④選項四。
 *   格式 B(坊間題庫常見):      (3) 1. 題幹？(1)選項一 (2)選項二 (3)選項三 (4)選項四。
 * 選項標記除了 ①②③④ / (1)(2)(3)(4) 之外，也接受 (A)(B)(C)(D)。
 *
 * 設計原則：正解、題幹、選項文字全部直接從文字裡「切」出來，不做任何語意判斷，
 * 更不會呼叫 AI 去猜——AI 只會在這支解析器之後，針對已經解析好的題目補寫詳解。
 * 切不出來的段落會放進 failedSegments，交還給老師自己確認，不會整批解析失敗。
 */

export type ParsedQuestion = {
  number: number;
  question: string;
  options: string[]; // 固定 4 個，已去除標記符號
  correctIndex: number; // 0-based
};

export type ParseResult = {
  questions: ParsedQuestion[];
  failedSegments: string[]; // 每一則是「第 N 題：原始片段前 80 字」，給老師人工確認用
};

const ANSWER_TOKEN_TO_INDEX: Record<string, number> = {
  1: 0,
  2: 1,
  3: 2,
  4: 3,
  A: 0,
  B: 1,
  C: 2,
  D: 3,
};

function normalizeAnswerToken(tok: string): number | null {
  const key = tok.trim().toUpperCase();
  return key in ANSWER_TOKEN_TO_INDEX ? ANSWER_TOKEN_TO_INDEX[key]! : null;
}

// 找「題號 + 正解」的起始位置：格式 A「N. (X)」或格式 B「(X) N.」
const ANCHOR_RE = /(\d+)\.\s*[(（]\s*([1-4A-D])\s*[)）]|[(（]\s*([1-4A-D])\s*[)）]\s*(\d+)\./gi;

// 選項標記：圈選數字，或括號包住的數字/字母
const OPTION_MARKER_RE = /[①②③④]|[(（]\s*[1-4A-D]\s*[)）]/i;

// 踩過的坑：PDF 文字擷取(unpdf)會在原始文件的換行處插入 \n，如果 PDF 排版剛好把一個
// 中文詞從中間斷行(例如「壓縮檔」跟「案」分兩行、合起來才是「壓縮檔案」)，這個 \n
// 會卡在詞中間，畫面上就會顯示成一個不該存在的空格。中文字跟中文字之間本來就不會
// 有空白，所以兩個中文字中間的空白/換行一律整段拿掉；其餘空白(通常是中英文交界處
// 「燒錄 CD」這種正常空格，或英數字之間的空格)收斂成一個空格，不整段刪除。
// CJK Unified Ideographs 範圍(U+4E00-U+9FFF)，用跳脫寫法而不是直接寫中文字元範圍，
// 避免 eslint regexp/no-obscure-range 抱怨「範圍邊界肉眼看不出來是什麼」
function normalizeWhitespace(s: string): string {
  return s
    .replace(/([\u4E00-\u9FFF])\s+(?=[\u4E00-\u9FFF])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBody(body: string): { stem: string; options: string[] } | null {
  const parts = body.split(OPTION_MARKER_RE);
  if (parts.length !== 5) {
    return null; // 沒有剛好切出「題幹 + 4 個選項」就視為解析失敗，交回人工確認
  }
  const stem = normalizeWhitespace(parts[0]!).replace(/[:：]\s*$/, '');
  // 先把開頭/結尾的「。」與空白一起清掉，再做中文斷行合併，順序不能反過來——
  // 不然「Ｄ腳 。」會先合併成「Ｄ腳 。」(句號前的空白不在中文字之間、不會被合併)，
  // 之後只拿掉句號卻留下句號前那個空白，變成尾端多一格的「Ｄ腳 」。
  const options = parts.slice(1).map(s => normalizeWhitespace(s.replace(/^[。\s]+|[。\s]+$/g, '')));
  if (!stem || options.some(o => !o)) {
    return null;
  }
  return { stem, options };
}

export function parseExamBankText(raw: string): ParseResult {
  const text = raw.replace(/\r\n/g, '\n');
  const anchors: { start: number; end: number; num: number; answerIdx: number }[] = [];

  ANCHOR_RE.lastIndex = 0;
  let m: RegExpExecArray | null = ANCHOR_RE.exec(text);
  while (m !== null) {
    const isFormatA = m[1] !== undefined;
    const num = Number(isFormatA ? m[1] : m[4]);
    const answerTok = isFormatA ? m[2]! : m[3]!;
    const answerIdx = normalizeAnswerToken(answerTok);
    if (answerIdx !== null && Number.isFinite(num)) {
      anchors.push({ start: m.index, end: ANCHOR_RE.lastIndex, num, answerIdx });
    }
    m = ANCHOR_RE.exec(text);
  }

  const questions: ParsedQuestion[] = [];
  const failedSegments: string[] = [];

  anchors.forEach((anchor, i) => {
    const bodyEnd = i + 1 < anchors.length ? anchors[i + 1]!.start : text.length;
    const body = text.slice(anchor.end, bodyEnd).trim();
    const parsed = parseBody(body);

    if (!parsed) {
      failedSegments.push(`第 ${anchor.num} 題：${body.slice(0, 80)}`);
      return;
    }
    if (anchor.answerIdx > parsed.options.length - 1) {
      failedSegments.push(`第 ${anchor.num} 題：正解編號超出選項數量`);
      return;
    }
    questions.push({
      number: anchor.num,
      question: parsed.stem,
      options: parsed.options,
      correctIndex: anchor.answerIdx,
    });
  });

  return { questions, failedSegments };
}
