import { beforeEach, describe, expect, it, vi } from 'vitest';

const { streamMock, generateMock } = vi.hoisted(() => ({
  streamMock: vi.fn(),
  generateMock: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'u1' }) }));
vi.mock('@/actions/aiUsageActions', () => ({
  checkAndIncrementAiUsage: async () => ({ allowed: true }),
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContentStream: streamMock, generateContent: generateMock };
  },
}));

const { POST } = await import('./route');

const RESULT = JSON.stringify({
  title: '光合作用',
  questions: [
    { type: 'mc', question: 'Q1', options: ['(A)a', '(B)b', '(C)c', '(D)d'], answer: 'A', explanation: '' },
    { type: 'mc', question: 'Q2', options: ['(A)a', '(B)b', '(C)c', '(D)d'], answer: 'B', explanation: '' },
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

function req(body: object) {
  return new Request('http://x/api/ai/generate-questions', { method: 'POST', body: JSON.stringify(body) });
}

async function readEvents(res: Response) {
  const text = await res.text();
  return text.trim().split('\n').map(l => JSON.parse(l));
}

describe('POST /api/ai/generate-questions', () => {
  beforeEach(() => {
    streamMock.mockReset();
    generateMock.mockReset();
    // route 在 fallback / 截斷 / 失敗時會寫 log，測試裡靜音（vitest-fail-on-console）
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('stream: true → NDJSON：title、逐題、done', async () => {
    streamMock.mockResolvedValue(chunksOf(RESULT, 17));
    const res = await POST(req({ topic: '光合作用', types: ['mc'], count: 2, stream: true }));

    expect(res.headers.get('content-type')).toContain('application/x-ndjson');

    const events = await readEvents(res);

    expect(events.map(e => e.type)).toEqual(['title', 'question', 'question', 'done']);
    expect(events[1].question.question).toBe('Q1');
    expect(events[3]).toMatchObject({ count: 2, model: 'gemini' });
  });

  it('串流中途截斷：保留已完成的題目並附 warning', async () => {
    const cut = RESULT.slice(0, RESULT.indexOf('"Q2"'));
    streamMock.mockResolvedValue(chunksOf(cut, 20, 'MAX_TOKENS'));
    const events = await readEvents(await POST(req({ topic: 't', types: ['mc'], stream: true })));

    expect(events.map(e => e.type)).toEqual(['title', 'question', 'warning', 'done']);
  });

  it('Gemini 一題都沒出且無備援金鑰 → error 事件', async () => {
    streamMock.mockRejectedValue(new Error('503 overloaded'));
    vi.stubEnv('OPENAI_API_KEY', '');
    const events = await readEvents(await POST(req({ topic: 't', types: ['mc'], stream: true })));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');

    vi.unstubAllEnvs();
  });

  it('未帶 stream → 維持一次回傳 JSON（舊呼叫端相容）', async () => {
    generateMock.mockResolvedValue({ text: RESULT, candidates: [{ finishReason: 'STOP' }] });
    const res = await POST(req({ topic: 't', types: ['mc'] }));
    const json = await res.json();

    expect(json.title).toBe('光合作用');
    expect(json.questions).toHaveLength(2);
    expect(streamMock).not.toHaveBeenCalled();
  });
});
