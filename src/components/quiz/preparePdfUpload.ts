/**
 * preparePdfUpload.ts — client 端上傳 PDF 前的處理（AIQuizModal / FileQuizGenerator 共用）
 *
 * 依 planPdfUpload 的決策：送原檔、用 pdf-lib 裁切、或擋下並顯示中文錯誤。
 * 最後一律再檢查一次最終檔案大小（裁切後仍可能超過 Vercel 上限）。
 */
import { checkFinalUploadSize, planPdfUpload } from '@/libs/pdfUploadPlan';

export type PreparedPdfUpload = {
  file: File;
  // true：送出的是原檔，需另外附 startPage/endPage 讓 server 裁切
  sendPageRange: boolean;
};

export class PdfUploadBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfUploadBlockedError';
  }
}

export async function preparePdfUpload(
  file: File,
  range: { totalPages: number | null; startPage: number; endPage: number },
): Promise<PreparedPdfUpload> {
  let isEncrypted = false;
  let srcDoc: import('pdf-lib').PDFDocument | null = null;

  // 讀得到頁數才有範圍可裁；用 ignoreEncryption 讀取，避免英文 EncryptedPDFError
  if (range.totalPages !== null) {
    try {
      const { PDFDocument } = await import('pdf-lib');
      srcDoc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
      isEncrypted = srcDoc.isEncrypted;
    } catch {
      // pdf-lib 解析不了（結構損毀等）：交給大小檢查，能送原檔就送，server 端再判斷
      srcDoc = null;
    }
  }

  const plan = planPdfUpload({
    fileSize: file.size,
    totalPages: range.totalPages,
    startPage: range.startPage,
    endPage: range.endPage,
    isEncrypted,
  });

  if (plan.kind === 'block') {
    throw new PdfUploadBlockedError(plan.error);
  }

  if (plan.kind === 'trim' && srcDoc) {
    const { PDFDocument } = await import('pdf-lib');
    const newDoc = await PDFDocument.create();
    const copiedPages = await newDoc.copyPages(srcDoc, plan.indices);
    copiedPages.forEach(page => newDoc.addPage(page));
    const trimmedBytes = await newDoc.save();
    const trimmed = new File([trimmedBytes as BlobPart], file.name, { type: 'application/pdf' });
    const sizeError = checkFinalUploadSize(trimmed.size);
    if (sizeError) {
      throw new PdfUploadBlockedError(sizeError);
    }
    // 裁切過的檔案已只含選中頁面，不需再傳 startPage/endPage
    return { file: trimmed, sendPageRange: false };
  }

  // 送原檔（含 pdf-lib 讀不進來、無法裁切的情況）
  const sizeError = checkFinalUploadSize(file.size);
  if (sizeError) {
    throw new PdfUploadBlockedError(sizeError);
  }
  return { file, sendPageRange: range.totalPages !== null };
}
