/**
 * AI 生成學科（檔案上傳模式）的檔案驗證——從
 * src/app/api/ai/generate-subject-from-file/route.ts 抽出成純函式方便單元測試，
 * 規則對齊 src/app/api/ai/generate-from-file/route.ts 既有的驗證邏輯（訊息用詞盡量一致，
 * 避免老師在 AI 出題跟 AI 生成學科看到兩套不一致的錯誤提示）。
 */

export const SUBJECT_UPLOAD_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'] as const;

export type SubjectFileValidationResult
  = | { ok: true }
  | { ok: false; error: string };

function getExt(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

/** 驗證上傳的檔名清單：允許單一 PDF，或一到多張圖片；不允許混雜、不允許多個 PDF */
export function validateSubjectUploadFiles(fileNames: string[]): SubjectFileValidationResult {
  if (fileNames.length === 0) {
    return { ok: false, error: '請上傳檔案' };
  }

  const imageSet = new Set<string>(SUBJECT_UPLOAD_IMAGE_EXTENSIONS);
  const exts = fileNames.map(getExt);
  const allImages = exts.every(e => imageSet.has(e));
  const firstIsPdf = exts[0] === 'pdf';

  if (!allImages && !(fileNames.length === 1 && firstIsPdf)) {
    if (fileNames.length > 1) {
      return { ok: false, error: '多檔上傳僅支援圖片格式（PDF 請單檔上傳）' };
    }
    return { ok: false, error: '支援 PDF、圖片格式（jpg/jpeg/png/webp/gif）' };
  }

  return { ok: true };
}

/** 副檔名轉成圖片 mimeType；未知副檔名 fallback 成 image/png（跟 generate-from-file 既有寫法一致） */
export function fileExtToImageMimeType(ext: string): string {
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
  };
  return map[ext] ?? 'image/png';
}
