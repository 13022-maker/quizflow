/**
 * pdfPreprocess.ts — 伺服器端「送 PDF 給 AI 多模態模型之前」的共用前處理
 *
 * generate-from-file 與 generate-subject-from-file 共用：偵測加密、決定頁數範圍、
 * 必要時用 pdf-lib 裁切。
 *
 * 踩過的坑（2026-10 修正）：過去一律 `PDFDocument.load(..., { ignoreEncryption: true })`
 * 再 `copyPages` 重新輸出，以為能「洗掉」加密限制。實際上 pdf-lib 不會解密：
 * copyPages 只是把仍然是密文的串流 bytes 原封不動搬到新檔、同時丟掉 /Encrypt，
 * 結果 AI 收到的是內容全是亂碼的 PDF（pdftotext 會報
 * 「Unknown compression method in flate stream」），AES-256 + object streams 的檔
 * 甚至在 pdf-lib 讀頁數時就 throw「Expected instance of PDFDict」。
 * 正確做法：加密檔一律送「原始 bytes」（AI 端的 PDF 解析器能處理空 user password
 * 的加密檔），不做 copyPages；頁數改用 pdf.js（unpdf）讀，它會正確解密。
 */
import { Buffer } from 'node:buffer';

import { PDFDocument } from 'pdf-lib';
import { getDocumentProxy } from 'unpdf';

import { MAX_PDF_PAGES_PER_REQUEST, resolvePdfPageRange } from '@/libs/pdfPageLimit';

export const PDF_CORRUPT_MESSAGE = 'PDF 檔案損毀或受保護，請另存新檔後再上傳';
export const PDF_ENCRYPTED_RANGE_MESSAGE = '此 PDF 有加密保護，無法擷取部分頁面。請用『列印 → 另存為 PDF』後再上傳';

/** 可預期的使用者端錯誤（檔案問題），route 直接以 status 回給前端 */
export class PdfPreprocessError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'PdfPreprocessError';
    this.status = status;
  }
}

export type PreparedPdf = {
  bytes: Uint8Array; // 要送給 AI 的 PDF
  encrypted: boolean;
  trimmed: boolean; // true = 已裁成只含選取頁；false = 原檔整份
  totalPages: number; // 原檔總頁數
  startPage: number; // 實際採用的範圍（1-based，含頭尾）
  endPage: number;
  // 加密檔無法裁切卻只選了部分頁時，請呼叫端在 prompt 註明只根據這幾頁出題
  pageHint?: { startPage: number; endPage: number };
};

// /Encrypt 一定出現在 trailer 或 xref stream dict（兩者都是明文），快速判斷要不要走 pdf.js
function mayBeEncrypted(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes('/Encrypt');
}

/** 用 pdf.js 讀加密檔的頁數與加密狀態；需要開啟密碼或檔案損毀 → PdfPreprocessError */
async function inspectWithPdfjs(bytes: Uint8Array): Promise<{ encrypted: boolean; totalPages: number }> {
  try {
    // 傳副本：pdf.js 可能把 ArrayBuffer transfer 給 worker，避免原始 bytes 被清空
    const doc = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
    const { info } = await doc.getMetadata();
    const encrypted = Boolean((info as { EncryptFilterName?: string | null }).EncryptFilterName);
    return { encrypted, totalPages: doc.numPages };
  } catch {
    throw new PdfPreprocessError(PDF_CORRUPT_MESSAGE);
  }
}

export async function preparePdfForAI(
  bytes: Uint8Array,
  requested: { startPage: number; endPage: number },
): Promise<PreparedPdf> {
  let encrypted = false;
  let totalPages = 0;

  if (mayBeEncrypted(bytes)) {
    ({ encrypted, totalPages } = await inspectWithPdfjs(bytes));
  }

  let srcDoc: PDFDocument | null = null;
  if (!encrypted) {
    try {
      srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      totalPages = srcDoc.getPageCount();
    } catch {
      throw new PdfPreprocessError(PDF_CORRUPT_MESSAGE);
    }
    // 保險：pdf-lib 認為有加密（上面 byte 判斷漏網）→ 改走加密流程
    if (srcDoc.isEncrypted) {
      encrypted = true;
      srcDoc = null;
    }
  }

  if (totalPages <= 0) {
    throw new PdfPreprocessError(PDF_CORRUPT_MESSAGE);
  }

  const range = resolvePdfPageRange({
    actualTotalPages: totalPages,
    requestedStartPage: requested.startPage,
    requestedEndPage: requested.endPage,
  });
  if (!range.ok) {
    throw new PdfPreprocessError(range.error);
  }
  // resolvePdfPageRange 不擋「起始頁 > 結束頁」（例如起始頁超過總頁數），會變成 0 頁 PDF
  if (range.endPage < range.startPage) {
    throw new PdfPreprocessError(
      `頁數範圍無效（第 ${range.startPage} 頁到第 ${range.endPage} 頁），此 PDF 共 ${totalPages} 頁，請重新選擇範圍`,
    );
  }

  if (encrypted) {
    // 加密檔不能裁切：整份原檔送出，所以整份必須在單次上限內
    if (totalPages > MAX_PDF_PAGES_PER_REQUEST) {
      throw new PdfPreprocessError(PDF_ENCRYPTED_RANGE_MESSAGE);
    }
    const isPartial = range.startPage !== 1 || range.endPage !== totalPages;
    return {
      bytes,
      encrypted: true,
      trimmed: false,
      totalPages,
      startPage: range.startPage,
      endPage: range.endPage,
      ...(isPartial ? { pageHint: { startPage: range.startPage, endPage: range.endPage } } : {}),
    };
  }

  const newDoc = await PDFDocument.create();
  const indices = Array.from(
    { length: range.endPage - range.startPage + 1 },
    (_, i) => range.startPage - 1 + i,
  );
  const copiedPages = await newDoc.copyPages(srcDoc!, indices);
  copiedPages.forEach(page => newDoc.addPage(page));
  return {
    bytes: await newDoc.save(),
    encrypted: false,
    trimmed: true,
    totalPages,
    startPage: range.startPage,
    endPage: range.endPage,
  };
}

/** 加密檔只選部分頁時附加到 prompt 的限定句（無 pageHint 回空字串） */
export function buildPageHintPrompt(pageHint: PreparedPdf['pageHint']): string {
  if (!pageHint) {
    return '';
  }
  return `\n\n【頁數範圍】本 PDF 為整份原檔，請只根據第 ${pageHint.startPage} 頁到第 ${pageHint.endPage} 頁的內容出題，其他頁面一律忽略。`;
}
