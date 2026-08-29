import { describe, expect, it } from 'vitest';

import { fileExtToImageMimeType, validateSubjectUploadFiles } from './subjectFileValidation';

describe('validateSubjectUploadFiles', () => {
  it('沒有任何檔案：拒絕', () => {
    const result = validateSubjectUploadFiles([]);

    expect(result).toEqual({ ok: false, error: '請上傳檔案' });
  });

  it('單一 PDF：放行', () => {
    const result = validateSubjectUploadFiles(['講義.pdf']);

    expect(result).toEqual({ ok: true });
  });

  it('單一圖片：放行', () => {
    const result = validateSubjectUploadFiles(['photo.jpg']);

    expect(result).toEqual({ ok: true });
  });

  it('多張圖片：放行', () => {
    const result = validateSubjectUploadFiles(['p1.jpg', 'p2.png', 'p3.webp']);

    expect(result).toEqual({ ok: true });
  });

  it('不支援的副檔名（例如 .docx）：拒絕', () => {
    const result = validateSubjectUploadFiles(['講義.docx']);

    expect(result.ok).toBe(false);
  });

  it('多檔但混雜 PDF：拒絕（多檔只能全部是圖片）', () => {
    const result = validateSubjectUploadFiles(['p1.jpg', '講義.pdf']);

    expect(result.ok).toBe(false);
  });

  it('多個 PDF：拒絕（PDF 只能單檔）', () => {
    const result = validateSubjectUploadFiles(['a.pdf', 'b.pdf']);

    expect(result.ok).toBe(false);
  });

  it('副檔名大小寫不影響判斷', () => {
    const result = validateSubjectUploadFiles(['PHOTO.JPG']);

    expect(result).toEqual({ ok: true });
  });
});

describe('fileExtToImageMimeType', () => {
  it('jpg/jpeg 轉成 image/jpeg', () => {
    expect(fileExtToImageMimeType('jpg')).toBe('image/jpeg');
    expect(fileExtToImageMimeType('jpeg')).toBe('image/jpeg');
  });

  it('png 轉成 image/png', () => {
    expect(fileExtToImageMimeType('png')).toBe('image/png');
  });

  it('webp / gif 轉成對應 mimeType', () => {
    expect(fileExtToImageMimeType('webp')).toBe('image/webp');
    expect(fileExtToImageMimeType('gif')).toBe('image/gif');
  });

  it('未知副檔名 fallback 成 image/png', () => {
    expect(fileExtToImageMimeType('bmp')).toBe('image/png');
  });
});
