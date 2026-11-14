/**
 * 程式題（C++ / Python…）出題規則：要求 AI 把完整程式碼以 markdown 圍欄區塊放進題目欄位。
 *
 * 背景：各出題 prompt 都寫「只回傳 JSON，不要 markdown」，又沒有任何欄位或指示要求附程式碼，
 * 導致 AI 出「下列程式的輸出為何？」卻不給程式碼。這段規則明確把「題目字串內的程式碼圍欄」
 * 列為「不要 markdown」的唯一例外，並示範 JSON 字串內換行要寫成 \n。
 * 顯示端用 src/lib/codeBlock.ts 解析圍欄並以等寬字體呈現。
 */

const FENCE = '```';

/**
 * @param field 題目文字所在的 JSON 欄位名稱（大多是 question；bloom-studio 是 content；aiActions 是 body）
 */
export function buildCodeSnippetRule(field = 'question'): string {
  const example = `"${field}": "下列 C++ 程式執行後的輸出為何？\\n${FENCE}cpp\\n#include <iostream>\\nusing namespace std;\\nint main() {\\n    int x = 3;\\n    cout << x * 2;\\n    return 0;\\n}\\n${FENCE}"`;
  return `

【程式題規則】若題目需要學生閱讀程式碼（例如「下列程式的輸出為何？」「參考以下程式碼」「找出程式中的錯誤」），必須把完整程式碼直接寫在 ${field} 欄位字串裡，用 markdown 圍欄程式碼區塊包起來並標註語言（cpp、c、python、java…），例如：
${example}
- 只要題幹提到「下列／以下／上述程式（碼）」，就一定要附上程式碼，不可省略，也不可把程式碼放在其他欄位
- 程式碼保留原本縮排（用空格），換行在 JSON 字串中一律寫成 \\n
- 這是「不要 markdown」規則的唯一例外：圍欄只能出現在 ${field}／options／explanation 字串內部，整份回應本身仍必須是純 JSON
- 程式碼必須能正確編譯執行，正確答案要與程式實際輸出一致`;
}
