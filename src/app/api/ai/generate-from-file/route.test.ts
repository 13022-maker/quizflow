import { beforeEach, describe, expect, it, vi } from 'vitest';

const { streamMock, generateMock, claudeMock } = vi.hoisted(() => ({
  streamMock: vi.fn(),
  generateMock: vi.fn(),
  claudeMock: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'u1' }) }));
vi.mock('@/actions/aiUsageActions', () => ({
  checkAndIncrementAiUsage: async () => ({ allowed: true }),
}));
vi.mock('@/lib/ai/textModel', () => ({ isProSafe: async () => true }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContentStream: streamMock, generateContent: generateMock };
  },
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: claudeMock };
  },
}));

// hasGeminiKey / hasAnthropicKey 在 module 載入時讀取，必須在 import route 前設好
vi.stubEnv('GEMINI_API_KEY', 'test-gemini');
vi.stubEnv('ANTHROPIC_API_KEY', 'test-anthropic');
const route = await import('./route');

const RESULT = JSON.stringify({
  title: '截圖測驗',
  questions: [
    { type: 'mc', question: 'Q1', options: ['(A)a', '(B)b', '(C)c', '(D)d'], answer: 'A', explanation: '' },
    { type: 'mc', question: 'Q2', options: ['(A)a', '(B)b', '(C)c', '(D)d'], answer: 'C', explanation: '' },
  ],
});

function chunksOf(text: string, size: number, finishReason = 'STOP') {
  const parts: { text: string; candidates?: { finishReason: string }[] }[] = [];
  for (let i = 0; i < text.length; i += size) {
    parts.push({ text: text.slice(i, i + size) });
  }
  parts[parts.length - 1]!.candidates = [{ finishReason }];
  return (async function* () {
    yield * parts;
  })();
}

function req(extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append('file', new File([new Uint8Array([137, 80, 78, 71])], '截圖.png', { type: 'image/png' }));
  fd.append('types', JSON.stringify(['mc']));
  fd.append('count', '2');
  fd.append('difficulty', 'medium');
  fd.append('model', 'gemini');
  for (const [k, v] of Object.entries(extra)) {
    fd.append(k, v);
  }
  return new Request('http://x/api/ai/generate-from-file', { method: 'POST', body: fd });
}

async function readEvents(res: Response) {
  return (await res.text()).trim().split('\n').map(l => JSON.parse(l));
}

describe('POST /api/ai/generate-from-file', () => {
  beforeEach(() => {
    streamMock.mockReset();
    generateMock.mockReset();
    claudeMock.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('maxDuration 放寬到 300 秒（Hobby + Fluid compute 上限），圖片出題不再卡 60 秒', () => {
    expect(route.maxDuration).toBe(300);
  });

  it('stream=true → NDJSON 逐題推送', async () => {
    streamMock.mockResolvedValue(chunksOf(RESULT, 13));
    const res = await route.POST(req({ stream: 'true' }));

    expect(res.headers.get('content-type')).toContain('application/x-ndjson');

    const ev = await readEvents(res);

    expect(ev.map(e => e.type)).toEqual(['title', 'question', 'question', 'done']);
    expect(ev[2].question.answer).toBe('C');
    expect(ev[3]).toEqual({ type: 'done', count: 2, model: 'gemini' });
  });

  it('stream=true 且 Gemini 截斷、一題都沒出 → 改走 Claude', async () => {
    streamMock.mockResolvedValue(chunksOf('{"title":"截圖測驗","questions":[{"type":"mc","quest', 8, 'MAX_TOKENS'));
    claudeMock.mockResolvedValue({ content: [{ type: 'text', text: RESULT }] });
    const ev = await readEvents(await route.POST(req({ stream: 'true' })));

    expect(ev.map(e => e.type)).toEqual(['title', 'question', 'question', 'done']);
    expect(ev.at(-1).model).toBe('claude');
  });

  it('stream=true 且 Gemini 金鑰錯誤 → 不走 Claude，回看得懂的錯誤', async () => {
    streamMock.mockRejectedValue(Object.assign(new Error('API key not valid'), { status: 403 }));
    const ev = await readEvents(await route.POST(req({ stream: 'true' })));

    expect(claudeMock).not.toHaveBeenCalled();
    expect(ev).toHaveLength(1);
    expect(ev[0].type).toBe('error');
    expect(ev[0].error).toContain('AI 金鑰驗證失敗');
  });

  it('未帶 stream → 維持一次回傳 JSON（FileQuizGenerator 舊呼叫端相容）', async () => {
    generateMock.mockResolvedValue({ text: RESULT, candidates: [{ finishReason: 'STOP' }] });
    const res = await route.POST(req());
    const json = await res.json();

    expect(json.questions).toHaveLength(2);
    expect(streamMock).not.toHaveBeenCalled();
  });
});
