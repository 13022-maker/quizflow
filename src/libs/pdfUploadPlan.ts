/**
 * pdfUploadPlan.ts — 決定上傳 PDF 前，client 端要「送原檔 / 用 pdf-lib 裁切 / 擋下」
 *
 * 抽成純函式方便測試，AIQuizModal 與 FileQuizGenerator 共用：
 * 1. Vercel Serverless request body 上限約 4.5MB；最終送出的檔案保留一點 multipart
 *    表頭空間，以 4.4MB 為準。讀不到頁數時會整份送出，過大要在前端就擋下來。
 * 2. 加密 PDF：pdf-lib 預設 load 會丟英文 EncryptedPDFError；就算 ignoreEncryption
 *    讀得進來，copyPages 產出的內容仍是加密過的位元組、新檔沒有解密資訊 → 亂碼。
 *    所以加密檔絕不在前端裁切，只在原檔夠小、且範圍可由 server 處理時送原檔。
 */
import { MAX_PDF_PAGES_PER_REQUEST } from './pdfPageLimit';

// 4.4MB：低於 Vercel 4.5MB body 上限，保留 multipart 表頭與其他欄位的空間
export const MAX_FINAL_UPLOAD_BYTES = Math.floor(4.4 * 1024 * 1024);

export const FINAL_TOO_LARGE_ERROR = '處理後檔案仍超過 4.5MB，請縮小頁數範圍';
export const ENCRYPTED_PDF_ERROR = '此 PDF 有加密保護，請用『列印 → 另存為 PDF』後再上傳';
export const PASSWORD_PDF_ERROR = '此 PDF 需要開啟密碼，請先移除密碼';
export const PAGE_COUNT_UNREADABLE_ERROR = '無法自動讀取這份 PDF 的頁數，若頁數超過 20 頁，命題可能會被拒絕。建議重新整理頁面再試一次，或改上傳較短的檔案。';

/** 最終要送出的檔案大小檢查；通過回傳 null，否則回傳錯誤訊息 */
export function checkFinalUploadSize(bytes: number): string | null {
  return bytes > MAX_FINAL_UPLOAD_BYTES ? FINAL_TOO_LARGE_ERROR : null;
}

export type PdfUploadPlan
  = | { kind: 'original' }
  | { kind: 'trim'; indices: number[] }
  | { kind: 'block'; error: string };

export function planPdfUpload(params: {
  fileSize: number;
  totalPages: number | null; // pdfjs 讀不到時為 null
  startPage: number;
  endPage: number;
  isEncrypted: boolean;
}): PdfUploadPlan {
  const { fileSize, totalPages, startPage, endPage, isEncrypted } = params;
  const fits = fileSize <= MAX_FINAL_UPLOAD_BYTES;

  if (totalPages === null) {
    // 讀不到頁數：只能整份送出，太大就擋
    return fits ? { kind: 'original' } : { kind: 'block', error: FINAL_TOO_LARGE_ERROR };
  }

  const safeStart = Math.max(1, startPage);
  const safeEnd = Math.max(safeStart, Math.min(endPage, totalPages));

  if (isEncrypted) {
    const rangePages = safeEnd - safeStart + 1;
    const isWholeDoc = safeStart === 1 && safeEnd === totalPages;
    if (fits && (isWholeDoc || rangePages <= MAX_PDF_PAGES_PER_REQUEST)) {
      return { kind: 'original' };
    }
    return { kind: 'block', error: ENCRYPTED_PDF_ERROR };
  }

  if (fits) {
    // 小檔案：送原檔，server 依 startPage/endPage 裁切
    return { kind: 'original' };
  }

  return {
    kind: 'trim',
    indices: Array.from({ length: safeEnd - safeStart + 1 }, (_, i) => safeStart - 1 + i),
  };
}

/** pdfjs 讀頁數失敗時的提示：需要密碼的檔案給明確說明 */
export function pdfPageCountErrorMessage(err: unknown): string {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
  if (name === 'PasswordException') {
    return PASSWORD_PDF_ERROR;
  }
  return PAGE_COUNT_UNREADABLE_ERROR;
}
