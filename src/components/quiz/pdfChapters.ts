/**
 * pdfChapters.ts
 * PDF 書籤（目錄）→ 章節頁碼範圍的純計算邏輯。
 * 與 pdfjs 無關，方便單獨測試。
 */

// 單一章節：含起始頁與結束頁
export type PdfChapter = { title: string; start: number; end: number };

// 尚未算結束頁的原始章節（由書籤解析得到起始頁）
export type RawChapter = { title: string; start: number };

/**
 * 把「各章起始頁」轉成「含結束頁、已排序、去重」的章節清單。
 * - 結束頁 = 下一章起始頁 − 1；最後一章 = 全書尾頁
 * - 依起始頁排序；相同起始頁只保留第一個
 * - 過濾標題空白或起始頁 < 1 的無效項
 */
export function buildChapters(raw: RawChapter[], totalPages: number): PdfChapter[] {
  // 過濾無效項並依起始頁排序
  const valid = raw
    .filter(c => c.title.trim() !== '' && c.start >= 1 && c.start <= totalPages)
    .sort((a, b) => a.start - b.start);

  // 去除重複起始頁（保留第一個標題）
  const deduped: RawChapter[] = [];
  for (const c of valid) {
    if (deduped.length === 0 || deduped[deduped.length - 1]!.start !== c.start) {
      deduped.push(c);
    }
  }

  // 回填結束頁
  return deduped.map((c, i) => {
    const next = deduped[i + 1];
    const end = next ? next.start - 1 : totalPages;
    return { title: c.title.trim(), start: c.start, end: Math.max(c.start, end) };
  });
}
