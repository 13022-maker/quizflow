/**
 * 填空題（含克漏字）答案比對用的共用正規化。
 *
 * 問題背景：正確答案存成「n²」（Unicode 上標），學生鍵盤打不出 ²，輸入「n2」卻被判錯。
 * 比對前把學生答案與正確答案都過一次 normalizeFillBlankAnswer：
 *   1. NFKC：全形轉半形（ｎ２ → n2）、上標／下標轉一般字元（n² → n2、H₂O → H2O、xⁿ → xn）
 *   2. 上標負號 ⁻ 經 NFKC 會變成數學減號 −（U+2212），再統一成鍵盤上的 -
 *   3. 去除所有空白（含全形空白）
 *   4. 移除次方記號 ** 與 ^（n^2、n**2 都等同 n2）
 *   5. 不分大小寫
 *
 * 使用處：
 *   - src/lib/practicePageSubmission.ts：線上練習頁送出後 server 重算填空分數
 *   - src/lib/exportFillBlankPracticePage.ts：練習頁 HTML 內嵌 JS 的「核對答案」
 *     （純 HTML 無法 import TS，所以另外提供等價的 FILL_BLANK_NORMALIZE_CLIENT_JS 字串，
 *     answerNormalize.test.ts 會實際執行該字串，確認兩邊結果一致）
 *   - src/lib/cloze.ts：克漏字逐格批改（學生端即時回饋與 server 計分共用）
 */

const MATH_MINUS = '−';

export function normalizeFillBlankAnswer(value: string): string {
  return value
    .normalize('NFKC')
    .split(MATH_MINUS)
    .join('-')
    .split('')
    .filter(ch => ch.trim() !== '')
    .join('')
    .split('**')
    .join('')
    .split('^')
    .join('')
    .toLowerCase();
}

/** 學生答案正規化後與正確答案相同才算對；正規化後是空字串一律算錯 */
export function isFillBlankAnswerCorrect(typed: string, answer: string): boolean {
  const normalizedTyped = normalizeFillBlankAnswer(typed);
  return normalizedTyped !== '' && normalizedTyped === normalizeFillBlankAnswer(answer);
}

/**
 * 練習頁內嵌 JS 版的正規化函式，邏輯必須與 normalizeFillBlankAnswer 完全一致。
 * 注意：這段字串會原樣塞進 TS template literal 產生的 HTML，內容不可含反引號、錢字號加大括號、反斜線
 * （所以用 split/join 而不用 regex，數學減號用 String.fromCharCode 產生）。
 */
export const FILL_BLANK_NORMALIZE_CLIENT_JS = `
  /* 填空答案正規化：全形／上下標轉一般字元、去空白、去 ^ 與 **、不分大小寫（同 src/lib/answerNormalize.ts） */
  function qfNormalizeAnswer(s){
    s=''+(s==null?'':s);
    if(s.normalize) s=s.normalize('NFKC');
    return s.split(String.fromCharCode(8722)).join('-')
      .split('').filter(function(ch){ return ch.trim()!==''; }).join('')
      .split('**').join('')
      .split('^').join('')
      .toLowerCase();
  }
`;
