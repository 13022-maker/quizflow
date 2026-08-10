/**
 * 克漏字題（cloze）共用工具：標記語法解析、批改、安全去標記、純規則隨機挑空。
 * 標記語法：[[答案]]，例如「光合作用需要[[陽光]]和[[水]]。」
 * question.body 直接存含 [[ ]] 標記的原始文章（不額外開欄位），
 * 讓老師編輯時原樣讀回、可重複編輯；correctAnswers 由伺服器端從 body 推導（見 questionActions.ts）。
 */

export const CLOZE_BLANK_REGEX = /\[\[([^[\]]+)\]\]/g;

export type ClozeSegment =
  | { kind: 'text'; text: string }
  | { kind: 'blank'; index: number; answer: string };

/** 把含標記的文章拆成「文字／空格」交錯的 segment 陣列，空格 index 依出現順序遞增 */
export function parseClozeBody(body: string): ClozeSegment[] {
  const segments: ClozeSegment[] = [];
  let lastIndex = 0;
  let blankIndex = 0;
  const regex = new RegExp(CLOZE_BLANK_REGEX);
  let match = regex.exec(body);
  while (match !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', text: body.slice(lastIndex, match.index) });
    }
    segments.push({ kind: 'blank', index: blankIndex, answer: match[1]!.trim() });
    blankIndex += 1;
    lastIndex = match.index + match[0].length;
    match = regex.exec(body);
  }
  if (lastIndex < body.length) {
    segments.push({ kind: 'text', text: body.slice(lastIndex) });
  }
  return segments;
}

/** 依文章順序回傳每個空格的正確答案 */
export function extractClozeAnswers(body: string): string[] {
  return parseClozeBody(body)
    .filter((s): s is Extract<ClozeSegment, { kind: 'blank' }> => s.kind === 'blank')
    .map(s => s.answer);
}

export function countClozeBlanks(body: string): number {
  return extractClozeAnswers(body).length;
}

const CLOZE_PLACEHOLDER = '＿＿＿＿';

/** 把標記換成安全佔位符，任何會把 body 丟給學生／AI／列印報告看的地方都要先過這層，避免洩漏答案 */
export function stripClozeMarkers(body: string, placeholder: string = CLOZE_PLACEHOLDER): string {
  return parseClozeBody(body)
    .map(s => (s.kind === 'text' ? s.text : placeholder))
    .join('');
}

export function normalizeClozeAnswer(v: string): string {
  return v.trim().toLocaleLowerCase();
}

export type ClozeGradeResult = {
  perBlank: boolean[];
  correctCount: number;
  totalBlanks: number;
  isCorrect: boolean; // 全部答對才 true（用過提示不影響這個判斷，只影響 awardedRatio）；totalBlanks 為 0 時視為 false
  awardedRatio: number; // 0~1，用過提示且答對的格子只算 0.5 分，totalBlanks 為 0 時為 0
};

/**
 * 逐格比對：trim + 大小寫不敏感的精準字串比對，不叫 AI。
 * hintedIndices：用過「💡 提示」的空格 index（見 pickClozeHintOptions），
 * 這些格子即使答對，對 awardedRatio 的貢獻也只算 0.5（不是 1），答錯仍是 0。
 */
export function gradeClozeAnswers(
  correctAnswers: string[],
  studentAnswers: (string | undefined)[] | undefined,
  hintedIndices: number[] = [],
): ClozeGradeResult {
  const hintedSet = new Set(hintedIndices);
  const totalBlanks = correctAnswers.length;
  const perBlank = correctAnswers.map((correct, i) => {
    const given = studentAnswers?.[i];
    return given !== undefined && normalizeClozeAnswer(given) === normalizeClozeAnswer(correct);
  });
  const correctCount = perBlank.filter(Boolean).length;
  const totalRatio = perBlank.reduce(
    (sum, ok, i) => sum + (ok ? (hintedSet.has(i) ? 0.5 : 1) : 0),
    0,
  );
  return {
    perBlank,
    correctCount,
    totalBlanks,
    isCorrect: totalBlanks > 0 && correctCount === totalBlanks,
    awardedRatio: totalBlanks > 0 ? totalRatio / totalBlanks : 0,
  };
}

/**
 * 「💡 提示」用的 3 選項：1 個正確答案 + 2 個幹擾項，純規則、不叫 AI、不用教師額外輸入。
 * 幹擾項來源分兩層：
 * 1. 優先用同一題「其他空格」的正確答案（去除跟目標答案重複的）——品質較好，
 *    跟題目情境相關。
 * 2. 第 1 層湊不到 2 個不重複的時，改用 passageBody（文章原文，含 [[ ]] 標記皆可）
 *    比照「🎲 隨機挑選」的規則（見 findClozeCandidates）從文章本身抽字當備援，
 *    排除同一題「任何一格」的正確答案（避免把其他空格的真答案偽裝成幹擾項），
 *    也排除已經在幹擾項池裡的詞。沒傳 passageBody 或抽不到字時，維持只看
 *    同題其他空格的行為。
 * 兩層合計還是湊不到 2 個不重複的幹擾項時回傳 null，呼叫端應該在拿到 null 時
 * 不顯示提示按鈕，不要硬湊假選項。
 */
export function pickClozeHintOptions(
  correctAnswers: string[],
  blankIndex: number,
  passageBody?: string,
): string[] | null {
  const correct = correctAnswers[blankIndex];
  if (correct === undefined) {
    return null;
  }
  const normalizedCorrect = normalizeClozeAnswer(correct);

  let distractorPool = Array.from(new Set(
    correctAnswers
      .filter((_, i) => i !== blankIndex)
      .filter(ans => normalizeClozeAnswer(ans) !== normalizedCorrect),
  ));

  if (distractorPool.length < 2 && passageBody) {
    const usedAnswers = new Set(correctAnswers.map(normalizeClozeAnswer));
    const textCandidates = parseClozeBody(passageBody)
      .filter((s): s is Extract<ClozeSegment, { kind: 'text' }> => s.kind === 'text')
      .flatMap(s => findClozeCandidates(s.text));
    // 正規化去重（trim + 大小寫不敏感），不能只用 Set 對原字串去重——
    // 否則像 "The"/"the" 會被當成兩個不同候選詞，湊成兩個看起來一樣的幹擾項
    const seenNormalized = new Set(distractorPool.map(normalizeClozeAnswer));
    const extraCandidates = textCandidates.filter((cand) => {
      const normalizedCand = normalizeClozeAnswer(cand);
      if (usedAnswers.has(normalizedCand) || seenNormalized.has(normalizedCand)) {
        return false;
      }
      seenNormalized.add(normalizedCand);
      return true;
    });
    distractorPool = [...distractorPool, ...extraCandidates];
  }

  if (distractorPool.length < 2) {
    return null;
  }
  const distractors = [...distractorPool].sort(() => Math.random() - 0.5).slice(0, 2);
  return [correct, ...distractors].sort(() => Math.random() - 0.5);
}

// ---------- 隨機挑空（教師編輯器用，純規則，不叫 AI） ----------
// 中文沒有分詞函式庫可用，這裡用「標點分隔的 2-4 字詞組」當粗略啟發式，
// 對英文/數字效果較好；中文長文建議老師手動用 [[ ]] 標記重點詞彙。

const ENGLISH_TOKEN = /^[a-z]{3,}$/iu;
const NUMBER_TOKEN = /^\d[\d.,%]*$/;
// CJK Unified Ideographs: U+4E00-U+9FFF，限制 2-4 字（粗略啟發式，無分詞庫）
// eslint-disable-next-line regexp/no-obscure-range
const CJK_PHRASE = /^[一-鿿]{2,4}$/;
// 捕捉組（括號）必須保留，String.split() 只有在 regex 含捕捉組時才會保留分隔符
const TOKEN_SPLIT = /([\s，。、！？「」『』,.!?;:()（）]+)/;

/** 掃出文字中可以拿來挖空的候選詞（尚未去重） */
export function findClozeCandidates(plainText: string): string[] {
  return plainText
    .split(TOKEN_SPLIT)
    .map(t => t.trim())
    .filter(t => t && (ENGLISH_TOKEN.test(t) || NUMBER_TOKEN.test(t) || CJK_PHRASE.test(t)));
}

/**
 * 從文章（可能已含部分 [[ ]] 標記）隨機挑 N 個「還沒被標記」的候選詞，
 * 自動包上 [[ ]]。只掃未標記的文字段落，不會動到既有標記，也不會雙重標記。
 */
export function applyRandomClozeBlanks(body: string, count: number): string {
  const segments = parseClozeBody(body);
  const textSegments = segments.filter((s): s is Extract<ClozeSegment, { kind: 'text' }> => s.kind === 'text');
  const candidates = Array.from(new Set(textSegments.flatMap(s => findClozeCandidates(s.text))));
  if (candidates.length === 0) {
    return body;
  }

  const n = Math.max(1, Math.min(count, candidates.length));
  const picked = new Set([...candidates].sort(() => Math.random() - 0.5).slice(0, n));
  const marked = new Set<string>();

  return segments
    .map((seg) => {
      if (seg.kind === 'blank') {
        return `[[${seg.answer}]]`;
      }
      return seg.text
        .split(TOKEN_SPLIT)
        .map((t) => {
          const trimmed = t.trim();
          if (trimmed && picked.has(trimmed) && !marked.has(trimmed)) {
            marked.add(trimmed);
            return t.replace(trimmed, `[[${trimmed}]]`);
          }
          return t;
        })
        .join('');
    })
    .join('');
}
