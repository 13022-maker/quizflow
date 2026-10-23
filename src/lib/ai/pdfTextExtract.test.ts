import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractPdfPageContent } from './pdfImageExtract';
import { EMPTY_PDF_TEXT_MESSAGE, EmptyPdfTextError, extractPdfText, extractPdfTextDetailed } from './pdfTextExtract';

// cjk-msung-nonembedded.pdf 由 reportlab UnicodeCIDFont('MSung-Light') 產生（編碼改成正確的
// UniCNS-UCS2-H；reportlab 預設誤配 UniGB-UCS2-H）：字型「不內嵌」，文字靠預先定義的
// CJK CMap（.bcmap）解碼——沒帶可用的 cMapUrl 時 pdfjs 會解析成空字串。
// blank-page.pdf 是沒有任何文字的空白頁，模擬掃描檔。
function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(__dirname, '__fixtures__', name)));
}

describe('extractPdfText（非內嵌 CJK 字型）', () => {
  it('能擷取出中文字', async () => {
    const text = await extractPdfText(loadFixture('cjk-msung-nonembedded.pdf'));

    expect(text).toContain('光合作用測驗');
    expect(text).toContain('植物行光合作用需要陽光');
  });

  it('extractPdfPageContent 逐頁擷取也能讀到中文', async () => {
    const { pageTexts } = await extractPdfPageContent(loadFixture('cjk-msung-nonembedded.pdf'));

    expect(pageTexts[0]).toContain('光合作用測驗');
  });
});

describe('讀不到文字（掃描檔 / 字型無法解析）', () => {
  it('extractPdfText 維持回傳字串（相容既有呼叫端），空白頁回傳空字串', async () => {
    const text = await extractPdfText(loadFixture('blank-page.pdf'));

    expect(text.trim()).toBe('');
  });

  it('extractPdfTextDetailed 標記 isEmpty 並附上中文提示', async () => {
    const result = await extractPdfTextDetailed(loadFixture('blank-page.pdf'));

    expect(result.isEmpty).toBe(true);
    expect(result.emptyReason).toBe('讀不到文字：可能是掃描檔（圖片），或字型無法解析');
  });

  it('extractPdfTextDetailed 有文字時 isEmpty=false', async () => {
    const result = await extractPdfTextDetailed(loadFixture('cjk-msung-nonembedded.pdf'));

    expect(result.isEmpty).toBe(false);
    expect(result.text).toContain('光合作用');
  });

  it('extractPdfText 傳 throwIfEmpty 時丟出可辨識的 EmptyPdfTextError', async () => {
    await expect(extractPdfText(loadFixture('blank-page.pdf'), { throwIfEmpty: true }))
      .rejects
      .toBeInstanceOf(EmptyPdfTextError);
    expect(EMPTY_PDF_TEXT_MESSAGE).toBe('讀不到文字：可能是掃描檔（圖片），或字型無法解析');
  });
});
