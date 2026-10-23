import { describe, expect, it } from 'vitest';

import {
  checkFinalUploadSize,
  ENCRYPTED_PDF_ERROR,
  FINAL_TOO_LARGE_ERROR,
  MAX_FINAL_UPLOAD_BYTES,
  PASSWORD_PDF_ERROR,
  pdfPageCountErrorMessage,
  planPdfUpload,
} from './pdfUploadPlan';

const MB = 1024 * 1024;

describe('MAX_FINAL_UPLOAD_BYTES', () => {
  it('是 4.4MB（保留 multipart 表頭空間，低於 Vercel 4.5MB 上限）', () => {
    expect(MAX_FINAL_UPLOAD_BYTES).toBe(4613734); // floor(4.4 * 1048576)
  });
});

describe('checkFinalUploadSize', () => {
  it('不超過上限：null', () => {
    expect(checkFinalUploadSize(4 * MB)).toBeNull();
    expect(checkFinalUploadSize(4613734)).toBeNull();
  });

  it('超過上限：回傳中文錯誤', () => {
    expect(checkFinalUploadSize(4613735)).toBe('處理後檔案仍超過 4.5MB，請縮小頁數範圍');
    expect(FINAL_TOO_LARGE_ERROR).toBe('處理後檔案仍超過 4.5MB，請縮小頁數範圍');
  });
});

describe('planPdfUpload', () => {
  it('小檔案：直接送原檔（server 端依頁數範圍裁切）', () => {
    expect(planPdfUpload({ fileSize: 2 * MB, totalPages: 30, startPage: 1, endPage: 10, isEncrypted: false }))
      .toEqual({ kind: 'original' });
  });

  it('讀不到頁數且檔案小：送整份原檔', () => {
    expect(planPdfUpload({ fileSize: 2 * MB, totalPages: null, startPage: 1, endPage: 1, isEncrypted: false }))
      .toEqual({ kind: 'original' });
  });

  it('讀不到頁數且檔案大：擋下（整份會被送出，一定超過上限）', () => {
    expect(planPdfUpload({ fileSize: 8 * MB, totalPages: null, startPage: 1, endPage: 1, isEncrypted: false }))
      .toEqual({ kind: 'block', error: '處理後檔案仍超過 4.5MB，請縮小頁數範圍' });
  });

  it('大檔案、未加密、有頁數：前端裁切（0-based index，範圍夾在總頁數內）', () => {
    expect(planPdfUpload({ fileSize: 8 * MB, totalPages: 12, startPage: 3, endPage: 99, isEncrypted: false }))
      .toEqual({ kind: 'trim', indices: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11] });
  });

  it('加密、小檔案、範圍 ≤20 頁：送原檔交給 server', () => {
    expect(planPdfUpload({ fileSize: 3 * MB, totalPages: 50, startPage: 1, endPage: 20, isEncrypted: true }))
      .toEqual({ kind: 'original' });
  });

  it('加密、小檔案、範圍是整份文件：送原檔', () => {
    expect(planPdfUpload({ fileSize: 3 * MB, totalPages: 25, startPage: 1, endPage: 25, isEncrypted: true }))
      .toEqual({ kind: 'original' });
  });

  it('加密、小檔案、範圍超過 20 頁且不是整份：擋下並提示另存', () => {
    expect(planPdfUpload({ fileSize: 3 * MB, totalPages: 50, startPage: 1, endPage: 21, isEncrypted: true }))
      .toEqual({ kind: 'block', error: '此 PDF 有加密保護，請用『列印 → 另存為 PDF』後再上傳' });
  });

  it('加密、大檔案：不能用 pdf-lib 裁切（會產生亂碼），擋下並提示另存', () => {
    expect(planPdfUpload({ fileSize: 8 * MB, totalPages: 10, startPage: 1, endPage: 5, isEncrypted: true }))
      .toEqual({ kind: 'block', error: ENCRYPTED_PDF_ERROR });
  });
});

describe('pdfPageCountErrorMessage', () => {
  it('pdfjs PasswordException：提示先移除開啟密碼', () => {
    const err = Object.assign(new Error('No password given'), { name: 'PasswordException' });

    expect(pdfPageCountErrorMessage(err)).toBe('此 PDF 需要開啟密碼，請先移除密碼');
    expect(PASSWORD_PDF_ERROR).toBe('此 PDF 需要開啟密碼，請先移除密碼');
  });

  it('其他錯誤：維持原本的「無法自動讀取頁數」提示', () => {
    expect(pdfPageCountErrorMessage(new Error('Invalid PDF structure'))).toContain('無法自動讀取這份 PDF 的頁數');
  });
});
