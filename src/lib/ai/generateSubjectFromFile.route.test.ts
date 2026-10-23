// generate-subject-from-file：PDF 前處理錯誤要回 400（過去 PDFDocument.load 在 try 外面 → 500），
// 加密 PDF 要送原始 bytes 給 AI（不能 copyPages 成密文亂碼）。
// generateSubject（AI）與 saveGeneratedSubject（DB）以 mock 取代，只驗證 route 送出的 media。
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { extractText, getDocumentProxy } from 'unpdf';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/ai/generate-subject-from-file/route';

const mocks = vi.hoisted(() => ({
  generateSubject: vi.fn(),
  saveGeneratedSubject: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: 'user_subject_file_test' }),
}));

vi.mock('@/actions/adaptiveActions', () => ({
  saveGeneratedSubject: mocks.saveGeneratedSubject,
}));

vi.mock('@/libs/adaptive/generate-subject', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/adaptive/generate-subject')>();
  return { ...actual, generateSubject: mocks.generateSubject };
});

const FIXTURES = path.join(__dirname, '__fixtures__', 'pdf');

function pdfRequest(file: File, extra: Record<string, string> = {}): Request {
  const fd = new FormData();
  fd.append('topic', '光合作用');
  fd.append('file', file);
  for (const [k, v] of Object.entries(extra)) {
    fd.append(k, v);
  }
  return new Request('http://localhost/api/ai/generate-subject-from-file', { method: 'POST', body: fd });
}

function fixtureFile(name: string): File {
  return new File([readFileSync(path.join(FIXTURES, name))], name, { type: 'application/pdf' });
}

beforeEach(() => {
  mocks.generateSubject.mockReset();
  mocks.saveGeneratedSubject.mockReset();
  mocks.generateSubject.mockResolvedValue({ name: 'stub' });
  mocks.saveGeneratedSubject.mockResolvedValue({ ok: true });
});

describe('POST /api/ai/generate-subject-from-file', () => {
  it('損毀的 PDF → 400「損毀或受保護」，不呼叫 AI', async () => {
    const res = await POST(pdfRequest(new File(['not a pdf'], 'broken.pdf', { type: 'application/pdf' })));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('PDF 檔案損毀或受保護，請另存新檔後再上傳');
    expect(mocks.generateSubject).not.toHaveBeenCalled();
  });

  it('加密且超過 20 頁 → 400 提示另存 PDF，不呼叫 AI', async () => {
    const res = await POST(pdfRequest(fixtureFile('encrypted-aes256-25pages.pdf'), { startPage: '1', endPage: '5' }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('此 PDF 有加密保護，無法擷取部分頁面。請用『列印 → 另存為 PDF』後再上傳');
    expect(mocks.generateSubject).not.toHaveBeenCalled();
  });

  it('加密 PDF（AES-256 + object streams）→ 送給 AI 的 media 仍可讀出原文', async () => {
    const res = await POST(pdfRequest(fixtureFile('encrypted-aes256-objstm-3pages.pdf')));

    expect(res.status).toBe(200);
    expect(mocks.generateSubject).toHaveBeenCalledTimes(1);

    const media = mocks.generateSubject.mock.calls[0]![2] as { mimeType: string; base64: string }[];

    expect(media).toHaveLength(1);
    expect(media[0]!.mimeType).toBe('application/pdf');

    const doc = await getDocumentProxy(new Uint8Array(Buffer.from(media[0]!.base64, 'base64')));
    const { text } = await extractText(doc, { mergePages: true });

    expect(text).toContain('Photosynthesis page 1');
  });

  it('起始頁大於結束頁 → 400，不呼叫 AI', async () => {
    const res = await POST(pdfRequest(fixtureFile('encrypted-rc4-3pages.pdf'), { startPage: '3', endPage: '1' }));

    expect(res.status).toBe(400);
    expect(mocks.generateSubject).not.toHaveBeenCalled();
  });
});
