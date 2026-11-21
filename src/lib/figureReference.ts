/**
 * 題目「提到圖表、卻沒附圖」偵測（比照 src/lib/codeBlock.ts 的 needsCodeSnippet）。
 *
 * 背景：AI 從 PDF 出題時，原始文件的電路圖／附圖不會被擷取存進題目，AI 卻照抄
 * 「如右圖所示之電路……則 R 值應為 ___ Ω」，學生端看不到圖、無法作答。
 * 老師端編輯器用 needsFigure() 顯示警告，提醒上傳圖片或改寫題目。
 */

// 圖表參照字樣：如圖／如右圖／下圖／上圖／右圖／附圖／圖一／圖 2／如下表／附表…
// - (?!書)：排除「上圖書館」
// - 圖＋編號前排除常見複合詞（地圖、試圖、意圖、企圖、藍圖、構圖、繪圖、製圖、拼圖）
const FIGURE_REFERENCE_RE
  = /(?:如[左右上下]?[圖表]|[上下左右]圖|[上下]表|附[圖表])(?!書)|(?<![地試意企藍構繪製拼])圖\s*[一二三四五六七八九十\d]/;

export function hasFigureReference(text: string | null | undefined): boolean {
  if (!text) {
    return false;
  }
  return FIGURE_REFERENCE_RE.test(text);
}

type FigureCheckQuestion = {
  body: string;
  imageUrl?: string | null;
  diagramSvg?: string | null;
};

/**
 * 題目提到圖表，但沒有題目圖片（imageUrl）也沒有 AI 圖解（diagramSvg）→ true。
 */
export function needsFigure(question: FigureCheckQuestion): boolean {
  if (question.imageUrl?.trim() || question.diagramSvg?.trim()) {
    return false;
  }
  return hasFigureReference(question.body);
}

export const MISSING_FIGURE_WARNING
  = '題目提到「圖／表」，但沒有附上圖片，學生作答時看不到。請上傳題目圖片，或把圖中資訊改寫成文字。';
