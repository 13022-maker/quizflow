// 伺服器端 PDF 前處理（加密偵測、頁數範圍、裁切）測試
// fixtures 用 qpdf 產生後 commit（CI 不必安裝 qpdf），內容是 pdf-lib 畫的
// 「Photosynthesis page N」純文字頁：
// - encrypted-rc4-3pages.pdf：RC4 128-bit、空 user password（常見「防修改/防列印」下載檔）
// - encrypted-aes256-objstm-3pages.pdf：AES-256 + object streams（pdf-lib 連頁數都讀不到）
// - encrypted-aes256-25pages.pdf：AES-256、25 頁（超過單次 20 頁上限）
// - encrypted-user-password.pdf：需要開啟密碼 "secret"
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PDFDocument, StandardFonts } from 'pdf-lib';
import { extractText, getDocumentProxy } from 'unpdf';
import { describe, expect, it } from 'vitest';

import { PdfPreprocessError, preparePdfForAI } from './pdfPreprocess';

const FIXTURES = path.join(__dirname, '__fixtures__', 'pdf');

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURES, name)));
}

async function makePlainPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pageCount; i++) {
    doc.addPage([200, 100]).drawText(`Photosynthesis page ${i}`, { x: 10, y: 50, size: 10, font });
  }
  return doc.save();
}

async function textOf(bytes: Uint8Array): Promise<string> {
  // 複製一份，避免 pdf.js 轉移/改動呼叫端的 buffer
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(doc, { mergePages: true });
  return text;
}

async function expectPreprocessError(promise: Promise<unknown>, message: string) {
  const err = await promise.then(() => null, (e: unknown) => e);

  expect(err).toBeInstanceOf(PdfPreprocessError);
  expect((err as PdfPreprocessError).status).toBe(400);
  expect((err as PdfPreprocessError).message).toBe(message);
}

const ENCRYPTED_RANGE_MSG = '此 PDF 有加密保護，無法擷取部分頁面。請用『列印 → 另存為 PDF』後再上傳';
const CORRUPT_MSG = 'PDF 檔案損毀或受保護，請另存新檔後再上傳';

describe('preparePdfForAI — 加密 PDF', () => {
  it('RC4 加密、3 頁、未指定範圍：送出的 bytes 仍可讀出原文（不能是 copyPages 後的密文）', async () => {
    const result = await preparePdfForAI(fixture('encrypted-rc4-3pages.pdf'), { startPage: 1, endPage: 0 });

    expect(result.encrypted).toBe(true);
    expect(result.totalPages).toBe(3);

    const text = await textOf(result.bytes);

    expect(text).toContain('Photosynthesis page 1');
    expect(text).toContain('Photosynthesis page 3');
  });

  it('AES-256 + object streams（pdf-lib 讀不到頁數）：仍能判斷頁數並送出可讀的原檔', async () => {
    const result = await preparePdfForAI(fixture('encrypted-aes256-objstm-3pages.pdf'), { startPage: 1, endPage: 3 });

    expect(result.encrypted).toBe(true);
    expect(result.totalPages).toBe(3);
    expect(await textOf(result.bytes)).toContain('Photosynthesis page 2');
  });

  it('加密且只選部分頁（全檔 ≤ 20 頁）：送整份原檔，回傳 pageHint 讓 prompt 限定頁數', async () => {
    const result = await preparePdfForAI(fixture('encrypted-rc4-3pages.pdf'), { startPage: 2, endPage: 3 });

    expect(result.trimmed).toBe(false);
    expect(result.startPage).toBe(2);
    expect(result.endPage).toBe(3);
    expect(result.pageHint).toEqual({ startPage: 2, endPage: 3 });
    expect(await textOf(result.bytes)).toContain('Photosynthesis page 1');
  });

  it('加密且全檔超過 20 頁：無法裁切 → 丟 400 並提示「列印 → 另存為 PDF」', async () => {
    await expectPreprocessError(
      preparePdfForAI(fixture('encrypted-aes256-25pages.pdf'), { startPage: 1, endPage: 5 }),
      ENCRYPTED_RANGE_MSG,
    );
  });

  it('需要開啟密碼的 PDF：丟 400「損毀或受保護」而不是 500', async () => {
    await expectPreprocessError(
      preparePdfForAI(fixture('encrypted-user-password.pdf'), { startPage: 1, endPage: 0 }),
      CORRUPT_MSG,
    );
  });
});

describe('preparePdfForAI — 一般 PDF', () => {
  it('依範圍裁切，只留下選取的頁', async () => {
    const result = await preparePdfForAI(await makePlainPdf(5), { startPage: 2, endPage: 3 });

    expect(result.encrypted).toBe(false);
    expect(result.trimmed).toBe(true);
    expect(result.pageHint).toBeUndefined();

    const out = await PDFDocument.load(result.bytes);

    expect(out.getPageCount()).toBe(2);

    const text = await textOf(result.bytes);

    expect(text).toContain('Photosynthesis page 2');
    expect(text).toContain('Photosynthesis page 3');
    expect(text).not.toContain('Photosynthesis page 1');
  });

  it('損毀（不是 PDF）的檔案：丟 400 而不是 unhandled 500', async () => {
    await expectPreprocessError(
      preparePdfForAI(new TextEncoder().encode('this is not a pdf at all'), { startPage: 1, endPage: 0 }),
      CORRUPT_MSG,
    );
  });

  it('起始頁大於結束頁：丟 400，不送 0 頁的 PDF', async () => {
    const err = await preparePdfForAI(await makePlainPdf(5), { startPage: 4, endPage: 2 }).then(() => null, (e: unknown) => e);

    expect(err).toBeInstanceOf(PdfPreprocessError);
    expect((err as PdfPreprocessError).status).toBe(400);
  });

  it('起始頁超過總頁數：丟 400', async () => {
    const err = await preparePdfForAI(await makePlainPdf(3), { startPage: 7, endPage: 9 }).then(() => null, (e: unknown) => e);

    expect(err).toBeInstanceOf(PdfPreprocessError);
  });

  it('範圍超過 20 頁：沿用 pdfPageLimit 的錯誤訊息', async () => {
    await expectPreprocessError(
      preparePdfForAI(await makePlainPdf(25), { startPage: 1, endPage: 25 }),
      '選取範圍共 25 頁，超過上限 20 頁，請縮小範圍後重試',
    );
  });
});
