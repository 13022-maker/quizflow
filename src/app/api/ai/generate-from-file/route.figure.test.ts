/**
 * generate-from-file：題目依賴原始檔的圖時，AI 輸出 figure 定位欄位，route 負責驗證並把頁碼
 * 換算成「上傳檔案」的頁碼（伺服器端只截 startPage–endPage 送給 AI），前端再依此裁切截圖。
 */
import { PDFDocument } from 'pdf-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  delete process.env.ANTHROPIC_API_KEY;
});

const geminiGenerate = vi.hoisted(() => vi.fn());

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: 'user_free' }),
}));

vi.mock('@/libs/Plan', () => ({
  isProOrAbove: async () => false,
  isUserProOrAbove: async () => false,
  getUserPlanId: async () => 'free',
}));

vi.mock('@/actions/aiUsageActions', () => ({
  checkAndIncrementAiUsage: async () => ({ allowed: true, remaining: 99 }),
}));

vi.mock('@/libs/DB', () => ({ db: {} }));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: (...args: unknown[]) => geminiGenerate(...args) };
  },
}));

function geminiReturns(json: unknown) {
  geminiGenerate.mockResolvedValue({ text: JSON.stringify(json), candidates: [{ finishReason: 'STOP' }] });
}

/** 送給 Gemini 的 prompt 文字（parts 最後一段） */
function sentPrompt(): string {
  const req = geminiGenerate.mock.calls[0]![0] as { contents: { parts: { text?: string }[] }[] };
  const parts = req.contents[0]!.parts;
  return parts[parts.length - 1]!.text ?? '';
}

async function makePdf(pages: number): Promise<File> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    doc.addPage([595, 842]);
  }
  const bytes = await doc.save();
  return new File([bytes as BlobPart], 'circuit.pdf', { type: 'application/pdf' });
}

function post(fd: FormData): Request {
  return new Request('http://localhost/api/ai/generate-from-file', { method: 'POST', body: fd });
}

const CIRCUIT_Q = {
  type: 'fill',
  question: '如圖所示之電路，電流表讀值為 0.5 A，則 R 值應為 ___ Ω。',
  answer: '6',
  explanation: '',
};

beforeEach(() => {
  geminiGenerate.mockReset();
});

describe('generate-from-file figure 定位', () => {
  it('PDF：prompt 用截圖定位版規則（不是 PR #119 的文字改寫版）', async () => {
    geminiReturns({ title: 't', questions: [CIRCUIT_Q] });
    const { POST } = await import('./route');
    const fd = new FormData();
    fd.append('file', await makePdf(1));
    fd.append('types', '["fill"]');

    await POST(post(fd));

    const prompt = sentPrompt();

    expect(prompt).toContain('"figure"');
    expect(prompt).not.toContain('必須把作答需要的所有資訊用文字完整寫進題目');
  });

  it('PDF 伺服器端截頁：AI 的第 1 頁換算成上傳檔案的第 startPage 頁；不合法的 figure 被移除', async () => {
    geminiReturns({
      title: '直流電路',
      questions: [
        { ...CIRCUIT_Q, figure: { page: 1, bbox: { left: 0.1, top: 0.3, right: 0.7, bottom: 0.6 } } },
        { ...CIRCUIT_Q, figure: { page: 1 } },
        { ...CIRCUIT_Q, figure: { page: 5, bbox: [0.1, 0.1, 0.5, 0.5] } },
      ],
    });
    const { POST } = await import('./route');
    const fd = new FormData();
    fd.append('file', await makePdf(3));
    fd.append('types', '["fill"]');
    fd.append('startPage', '2');
    fd.append('endPage', '3');

    const res = await POST(post(fd));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.questions[0].figure).toEqual({ page: 2, bbox: { left: 0.1, top: 0.3, right: 0.7, bottom: 0.6 } });
    expect(body.questions[1].figure).toEqual({ page: 2, bbox: null });
    expect(body.questions[2].figure).toBeUndefined();
  });

  it('多張圖片：page 為第幾張圖片，超過張數的 figure 被移除', async () => {
    geminiReturns({
      title: '學習單',
      questions: [
        { ...CIRCUIT_Q, figure: { page: 2, bbox: [100, 200, 600, 700] } },
        { ...CIRCUIT_Q, figure: { page: 3 } },
      ],
    });
    const { POST } = await import('./route');
    const fd = new FormData();
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    fd.append('file', new File([png], 'p1.png', { type: 'image/png' }));
    fd.append('file', new File([png], 'p2.png', { type: 'image/png' }));
    fd.append('types', '["fill"]');

    const res = await POST(post(fd));
    const body = await res.json();

    expect(sentPrompt()).toContain('第幾張圖片');
    expect(body.questions[0].figure).toEqual({ page: 2, bbox: { left: 0.1, top: 0.2, right: 0.6, bottom: 0.7 } });
    expect(body.questions[1].figure).toBeUndefined();
  });
});
