/**
 * 決定 AI 出題（上傳 PDF）這一次要送去給模型的頁數範圍。
 *
 * 從 src/app/api/ai/generate-from-file/route.ts 抽出成純函式：
 * 1. 該檔案是 API Route，不方便單元測試，邏輯抽出來才能測
 * 2. 修復真實踩過的坑：前端 pdfjs-dist 讀取頁數若失敗（見 AIQuizModal.tsx /
 *    FileQuizGenerator.tsx 的 handleFiles catch），不會送 startPage/endPage，
 *    過去伺服器端完全沒有防護，會把整份大 PDF（曾遇過 43 頁的證照題庫）原封
 *    不動送給 AI，命題耗時很容易超過 Vercel maxDuration 逾時，前端只能看到
 *    籠統的「命題失敗」。這裡一律用伺服器端量到的真實頁數判斷，不信任前端。
 */

export const MAX_PDF_PAGES_PER_REQUEST = 20;

export type PdfPageRangeResult
  = | { ok: true; startPage: number; endPage: number }
  | { ok: false; error: string };

export function resolvePdfPageRange(params: {
  actualTotalPages: number;
  requestedStartPage: number; // 前端傳來的 startPage；未傳時呼叫端應傳 1
  requestedEndPage: number; // 前端傳來的 endPage；未傳時呼叫端應傳 0
}): PdfPageRangeResult {
  const { actualTotalPages, requestedStartPage, requestedEndPage } = params;

  if (requestedEndPage <= 0) {
    // 前端沒有指定範圍（常見原因：讀取頁數失敗，pdfPageCount 維持 null）：
    // 只有整份 PDF 本來就沒超過上限時才放行，避免大檔案整份直接送給 AI
    if (actualTotalPages > MAX_PDF_PAGES_PER_REQUEST) {
      return {
        ok: false,
        error: `此 PDF 共 ${actualTotalPages} 頁，超過單次命題上限 ${MAX_PDF_PAGES_PER_REQUEST} 頁。系統未能自動讀取頁數範圍選擇器，請重新整理頁面再試一次，或改上傳較短的檔案。`,
      };
    }
    return { ok: true, startPage: 1, endPage: actualTotalPages };
  }

  const safeStart = Math.max(1, requestedStartPage);
  const safeEnd = Math.min(requestedEndPage, actualTotalPages);
  const pageCount = safeEnd - safeStart + 1;
  if (pageCount > MAX_PDF_PAGES_PER_REQUEST) {
    return {
      ok: false,
      error: `選取範圍共 ${pageCount} 頁，超過上限 ${MAX_PDF_PAGES_PER_REQUEST} 頁，請縮小範圍後重試`,
    };
  }
  return { ok: true, startPage: safeStart, endPage: safeEnd };
}
