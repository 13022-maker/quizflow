/**
 * AI 出題圖解 SVG 產生器。
 *
 * AI 只回傳結構化語意資料(見下方 DiagramData),SVG markup 完全由這支檔案的 4 個
 * template 渲染函式產生 —— AI 從頭到尾拿不到 SVG 語法控制權,是這支檔案安全模型
 * 的基礎:文字插進 template 前一律先過 escapeSvgText,assertSvgSafe 是防禦性最後
 * 一關(理論上永遠不該觸發)。詳見 docs/superpowers/specs/2026-09-12-ai-diagram-svg-design.md
 */

export class DiagramTooComplexError extends Error {}

/**
 * 所有插進 SVG template 的 AI 文字都必須先過這層,沒有例外路徑。
 */
export function escapeSvgText(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 防禦性最後一關(belt-and-suspenders):理論上這些字串永遠不會出現在我們自己的
 * template 輸出裡(template 本身沒有這些標籤/屬性),純粹防未來改 template 時手滑。
 */
export function assertSvgSafe(svg: string): void {
  const forbidden = [
    /<script/i,
    /on\w+\s*=/i,
    /javascript:/i,
    /<foreignObject/i,
    /(?:xlink:)?href\s*=/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(svg)) {
      throw new Error(`assertSvgSafe: 輸出包含禁止的內容(命中 ${pattern})`);
    }
  }
}
