import { describe, expect, it } from 'vitest';

import { MAX_PDF_PAGES_PER_REQUEST, resolvePdfPageRange } from './pdfPageLimit';

describe('resolvePdfPageRange', () => {
  it('前端沒有指定範圍（endPage=0）且整份 PDF 沒超過上限：直接放行整份文件', () => {
    const result = resolvePdfPageRange({
      actualTotalPages: 10,
      requestedStartPage: 1,
      requestedEndPage: 0,
    });

    expect(result).toEqual({ ok: true, startPage: 1, endPage: 10 });
  });

  it('前端沒有指定範圍（endPage=0）且整份 PDF 超過上限：拒絕，訊息含實際頁數與上限', () => {
    // 對應真實案例：前端讀取頁數失敗（pdfPageCount 維持 null）導致沒傳 endPage，
    // 43 頁的 PDF 過去會被整份直接送去 AI，這裡要擋下來
    const result = resolvePdfPageRange({
      actualTotalPages: 43,
      requestedStartPage: 1,
      requestedEndPage: 0,
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toContain('43');
      expect(result.error).toContain(String(MAX_PDF_PAGES_PER_REQUEST));
    }
  });

  it('前端有指定合法範圍：放行，回傳夾好的頁數範圍', () => {
    const result = resolvePdfPageRange({
      actualTotalPages: 43,
      requestedStartPage: 5,
      requestedEndPage: 15,
    });

    expect(result).toEqual({ ok: true, startPage: 5, endPage: 15 });
  });

  it('前端指定範圍超過上限（>20 頁）：拒絕，訊息含選取頁數與上限', () => {
    const result = resolvePdfPageRange({
      actualTotalPages: 43,
      requestedStartPage: 1,
      requestedEndPage: 25,
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toContain('25');
      expect(result.error).toContain(String(MAX_PDF_PAGES_PER_REQUEST));
    }
  });

  it('前端傳來的 endPage 超過實際總頁數（過期/不準確的頁數資訊）：夾到實際總頁數再判斷', () => {
    const result = resolvePdfPageRange({
      actualTotalPages: 10,
      requestedStartPage: 1,
      requestedEndPage: 999,
    });

    expect(result).toEqual({ ok: true, startPage: 1, endPage: 10 });
  });

  it('前端傳來的 startPage < 1：夾到 1', () => {
    const result = resolvePdfPageRange({
      actualTotalPages: 10,
      requestedStartPage: -3,
      requestedEndPage: 5,
    });

    expect(result).toEqual({ ok: true, startPage: 1, endPage: 5 });
  });

  it('剛好等於上限（20 頁）：放行，不誤判為超過', () => {
    const result = resolvePdfPageRange({
      actualTotalPages: 43,
      requestedStartPage: 1,
      requestedEndPage: 20,
    });

    expect(result).toEqual({ ok: true, startPage: 1, endPage: 20 });
  });
});
