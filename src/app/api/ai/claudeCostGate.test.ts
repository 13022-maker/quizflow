/**
 * 成本閘門：Free 用戶與未登入請求一律不會花到 Claude API 錢。
 *
 * 背景（2026-11-07 掃描）：多支 AI route 在 Gemini 失敗/截斷時備援鏈會直接打 Claude、
 * 不看方案；generate-flashcards 是 public route 完全沒 auth；bloom-studio 固定用
 * Claude Haiku 且只扣額度不看方案；textModel.generateAIText 對免費/匿名請求在
 * Gemini（＋Grok）都失敗時也會補打 Claude。
 *
 * 規則：Free / 未登入 → 只能走非 Claude provider，全部失敗回清楚的繁中錯誤；
 *       Pro（含試用）→ 行為不變，Gemini 失敗可以走 Claude。
 *
 * 外部 SDK 全部 mock：Gemini 一律回「截斷」或錯誤，Anthropic SDK 與
 * fetch('https://api.anthropic.com/...') 都會被記錄，用來斷言「有沒有花到 Claude 錢」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  // route 模組在 import 時就讀金鑰（hasAnthropicKey 等），要在 import 前設好
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  delete process.env.GROK_API_KEY;
  delete process.env.ANTHROPIC_API_KEY_BACKUP;
  delete process.env.GEMINI_API_KEY_BACKUP;
  delete process.env.OPENAI_API_KEY_BACKUP;
  return { userId: 'user_free' as string | null, isPro: false };
});

const anthropicCreate = vi.hoisted(() => vi.fn());
const anthropicStream = vi.hoisted(() => vi.fn());
const geminiGenerate = vi.hoisted(() => vi.fn());

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: state.userId }),
}));

vi.mock('@/libs/Plan', () => ({
  isProOrAbove: async () => state.isPro,
  isUserProOrAbove: async () => state.isPro,
  getUserPlanId: async () => (state.isPro ? 'premium' : 'free'),
}));

vi.mock('@/actions/aiUsageActions', () => ({
  checkAndIncrementAiUsage: async () => ({ allowed: true, remaining: 99 }),
}));

vi.mock('@/libs/DB', () => ({ db: {} }));

// youtube-transcript 是 CJS/ESM 混合套件，vitest 直接載入會炸；本測試只用 Google Docs 連結
vi.mock('youtube-transcript', () => ({ YoutubeTranscript: { fetchTranscript: vi.fn() } }));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: (...args: unknown[]) => geminiGenerate(...args) };
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: (...args: unknown[]) => anthropicCreate(...args),
      stream: (...args: unknown[]) => anthropicStream(...args),
    };
  },
}));

const fetchMock = vi.fn();

/** 這次測試總共打了幾次 Claude（SDK create / stream ＋ 直接 fetch Anthropic REST） */
function claudeCallCount(): number {
  const restCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('api.anthropic.com')).length;
  return anthropicCreate.mock.calls.length + anthropicStream.mock.calls.length + restCalls;
}

const QUESTIONS_JSON = JSON.stringify({
  title: '光合作用',
  questions: [{ type: 'mc', question: '題目', options: ['(A)甲', '(B)乙', '(C)丙', '(D)丁'], answer: 'A', explanation: '說明' }],
});
const VOCAB_JSON = JSON.stringify({ title: '水果', words: [{ english: 'apple', chinese: '蘋果', example: 'I eat an apple.' }] });
const FLASHCARDS_JSON = JSON.stringify([{ front: 'apple', back: '蘋果', example: 'I eat an apple.', phonetic: '/ˈæp.əl/' }]);

/** Claude 回應成功（SDK 與 REST 兩種寫法都回同一段文字） */
function claudeReturns(text: string) {
  anthropicCreate.mockResolvedValue({ content: [{ type: 'text', text }] });
  fetchMock.mockImplementation(async (url: unknown) => {
    const u = String(url);
    if (u.includes('api.anthropic.com')) {
      return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 });
    }
    if (u.includes('docs.google.com')) {
      return new Response('光合作用是植物利用葉綠素吸收陽光，把二氧化碳和水轉成養分與氧氣的過程。', { status: 200 });
    }
    // OpenAI 等其他備援：一律失敗，逼備援鏈往下走
    return new Response('upstream error', { status: 500 });
  });
}

/** Gemini 回應被截斷（finishReason=MAX_TOKENS）→ 舊程式會改走 Claude 重出 */
function geminiTruncates() {
  geminiGenerate.mockResolvedValue({ text: '{"questions":[', candidates: [{ finishReason: 'MAX_TOKENS' }] });
}

/** Gemini 直接失敗（不可重試的錯誤，避免觸發 backoff 拖慢測試） */
function geminiFails() {
  geminiGenerate.mockRejectedValue(Object.assign(new Error('Gemini 請求失敗'), { status: 400 }));
}

function asFree() {
  state.userId = 'user_free';
  state.isPro = false;
}

function asPro() {
  state.userId = 'user_pro';
  state.isPro = true;
}

function asAnonymous() {
  state.userId = null;
  state.isPro = false;
}

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function imageForm(field: string, extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.append(field, new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'photo.png', { type: 'image/png' }));
  for (const [k, v] of Object.entries(extra)) {
    fd.append(k, v);
  }
  return fd;
}

function formRequest(path: string, fd: FormData): Request {
  return new Request(`http://localhost${path}`, { method: 'POST', body: fd });
}

/** Free / 未登入被擋下時：不能是 200，且要回繁中錯誤訊息 */
async function expectClearChineseError(res: Response) {
  expect(res.status).toBeGreaterThanOrEqual(400);

  const body = await res.json();

  expect(typeof body.error).toBe('string');
  expect(body.error).toMatch(/\p{Script=Han}/u);
}

beforeEach(() => {
  anthropicCreate.mockReset();
  anthropicStream.mockReset();
  geminiGenerate.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // route 在備援時會 console.warn / console.error，這裡要驗的是行為不是 log
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  asFree();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('generate-flashcards（學生端 QuizTaker 也會呼叫，保留 public）', () => {
  it('未登入 + Gemini 失敗 → 不呼叫 Claude，回繁中錯誤', async () => {
    asAnonymous();
    geminiFails();
    claudeReturns(FLASHCARDS_JSON);
    const { POST } = await import('./generate-flashcards/route');

    const res = await POST(jsonRequest('/api/ai/generate-flashcards', { words: 'apple' }));

    expect(claudeCallCount()).toBe(0);

    await expectClearChineseError(res);
  });

  it('Free 登入 + Gemini 失敗 → 不呼叫 Claude', async () => {
    geminiFails();
    claudeReturns(FLASHCARDS_JSON);
    const { POST } = await import('./generate-flashcards/route');

    const res = await POST(jsonRequest('/api/ai/generate-flashcards', { words: 'apple' }));

    expect(claudeCallCount()).toBe(0);

    await expectClearChineseError(res);
  });

  it('Pro + Gemini 失敗 → 照舊 fallback Claude', async () => {
    asPro();
    geminiFails();
    claudeReturns(FLASHCARDS_JSON);
    const { POST } = await import('./generate-flashcards/route');

    const res = await POST(jsonRequest('/api/ai/generate-flashcards', { words: 'apple' }));

    expect(claudeCallCount()).toBe(1);
    expect(res.status).toBe(200);
    expect((await res.json()).cards).toHaveLength(1);
  });
});

describe('generate-questions', () => {
  const body = { topic: '光合作用', types: ['mc'], count: 1 };

  it('Free + Gemini 截斷 + OpenAI 失敗 → 不呼叫 Claude，回繁中錯誤', async () => {
    geminiTruncates();
    claudeReturns(QUESTIONS_JSON);
    const { POST } = await import('./generate-questions/route');

    const res = await POST(jsonRequest('/api/ai/generate-questions', body));

    expect(claudeCallCount()).toBe(0);

    await expectClearChineseError(res);
  });

  it('Pro + Gemini 截斷 + OpenAI 失敗 → 照舊走 Claude 第三備援', async () => {
    asPro();
    geminiTruncates();
    claudeReturns(QUESTIONS_JSON);
    const { POST } = await import('./generate-questions/route');

    const res = await POST(jsonRequest('/api/ai/generate-questions', body));

    expect(claudeCallCount()).toBe(1);
    expect(res.status).toBe(200);
  });
});

describe('generate-review-set', () => {
  const body = { title: '你覺得 AI 會取代老師嗎？' };

  it('Free + Gemini 截斷 + OpenAI 失敗 → 不呼叫 Claude', async () => {
    geminiTruncates();
    claudeReturns('{}');
    const { POST } = await import('./generate-review-set/route');

    const res = await POST(jsonRequest('/api/ai/generate-review-set', body));

    expect(claudeCallCount()).toBe(0);

    await expectClearChineseError(res);
  });

  it('Pro + Gemini 截斷 + OpenAI 失敗 → 照舊走 Claude', async () => {
    asPro();
    geminiTruncates();
    claudeReturns('{}');
    const { POST } = await import('./generate-review-set/route');

    await POST(jsonRequest('/api/ai/generate-review-set', body));

    expect(claudeCallCount()).toBe(1);
  });
});

describe('generate-vocab', () => {
  const body = { topic: '水果', count: 1 };

  it('Free + Gemini 截斷 → 不呼叫 Claude，回繁中錯誤', async () => {
    geminiTruncates();
    claudeReturns(VOCAB_JSON);
    const { POST } = await import('./generate-vocab/route');

    const res = await POST(jsonRequest('/api/ai/generate-vocab', body));

    expect(claudeCallCount()).toBe(0);

    await expectClearChineseError(res);
  });

  it('Pro + Gemini 截斷 → 照舊 fallback Claude', async () => {
    asPro();
    geminiTruncates();
    claudeReturns(VOCAB_JSON);
    const { POST } = await import('./generate-vocab/route');

    const res = await POST(jsonRequest('/api/ai/generate-vocab', body));

    expect(claudeCallCount()).toBe(1);
    expect(res.status).toBe(200);
  });
});

describe('generate-vocab-from-image', () => {
  it('Free + Gemini 失敗 → 不呼叫 Claude，回繁中錯誤', async () => {
    geminiFails();
    claudeReturns(VOCAB_JSON);
    const { POST } = await import('./generate-vocab-from-image/route');

    const res = await POST(formRequest('/api/ai/generate-vocab-from-image', imageForm('image')));

    expect(claudeCallCount()).toBe(0);

    await expectClearChineseError(res);
  });

  it('Pro + Gemini 失敗 → 照舊 fallback Claude', async () => {
    asPro();
    geminiFails();
    claudeReturns(VOCAB_JSON);
    const { POST } = await import('./generate-vocab-from-image/route');

    const res = await POST(formRequest('/api/ai/generate-vocab-from-image', imageForm('image')));

    expect(claudeCallCount()).toBe(1);
    expect(res.status).toBe(200);
  });
});

describe('generate-from-url', () => {
  const docUrl = 'https://docs.google.com/document/d/abc123/edit';

  it('Free 指定 model=claude → 靜默改走 Gemini，不呼叫 Claude', async () => {
    geminiGenerate.mockResolvedValue({ text: QUESTIONS_JSON, candidates: [{ finishReason: 'STOP' }] });
    claudeReturns(QUESTIONS_JSON);
    const { POST } = await import('./generate-from-url/route');

    const res = await POST(jsonRequest('/api/ai/generate-from-url', { url: docUrl, model: 'claude', count: 1 }));

    expect(claudeCallCount()).toBe(0);
    expect(geminiGenerate).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it('Free + Gemini 截斷 → 不呼叫 Claude 重出，回繁中錯誤', async () => {
    geminiTruncates();
    claudeReturns(QUESTIONS_JSON);
    const { POST } = await import('./generate-from-url/route');

    const res = await POST(jsonRequest('/api/ai/generate-from-url', { url: docUrl, count: 1 }));

    expect(claudeCallCount()).toBe(0);

    await expectClearChineseError(res);
  });

  it('Pro + Gemini 截斷 → 照舊走 Claude 重出', async () => {
    asPro();
    geminiTruncates();
    claudeReturns(QUESTIONS_JSON);
    const { POST } = await import('./generate-from-url/route');

    const res = await POST(jsonRequest('/api/ai/generate-from-url', { url: docUrl, count: 1 }));

    expect(claudeCallCount()).toBe(1);
    expect(res.status).toBe(200);
  });
});

describe('generate-from-file', () => {
  it('Free + Gemini 截斷 → 不呼叫 Claude 重出，回繁中錯誤', async () => {
    geminiTruncates();
    claudeReturns(QUESTIONS_JSON);
    const { POST } = await import('./generate-from-file/route');

    const res = await POST(formRequest('/api/ai/generate-from-file', imageForm('file', { count: '1' })));

    expect(claudeCallCount()).toBe(0);

    await expectClearChineseError(res);
  });

  it('Pro + Gemini 截斷 → 照舊走 Claude 重出', async () => {
    asPro();
    geminiTruncates();
    claudeReturns(QUESTIONS_JSON);
    const { POST } = await import('./generate-from-file/route');

    const res = await POST(formRequest('/api/ai/generate-from-file', imageForm('file', { count: '1' })));

    expect(claudeCallCount()).toBe(1);
    expect(res.status).toBe(200);
  });
});

describe('bloom-studio（固定 Claude Haiku）', () => {
  const body = { content: '光合作用是植物利用陽光製造養分的過程', numQuestions: 1 };

  it('Free → 403 引導升級，不呼叫 Claude', async () => {
    claudeReturns('{"questions":[]}');
    const { POST } = await import('./bloom-studio/route');

    const res = await POST(jsonRequest('/api/ai/bloom-studio', body));

    expect(claudeCallCount()).toBe(0);
    expect(res.status).toBe(403);
    expect((await res.json()).upgradeRequired).toBe(true);
  });

  it('Pro → 照舊呼叫 Claude', async () => {
    asPro();
    claudeReturns('{"questions":[]}');
    const { POST } = await import('./bloom-studio/route');

    await POST(jsonRequest('/api/ai/bloom-studio', body));

    expect(claudeCallCount()).toBe(1);
  });
});

describe('regenerate-question（既有 Pro 閘門，鎖住不退化）', () => {
  it('Free → 403，不呼叫 Claude', async () => {
    geminiTruncates();
    claudeReturns(QUESTIONS_JSON);
    const { POST } = await import('./regenerate-question/[id]/route');

    const res = await POST(jsonRequest('/api/ai/regenerate-question/1', {}), { params: { id: '1' } });

    expect(claudeCallCount()).toBe(0);
    expect(res.status).toBe(403);
  });
});

describe('textModel.generateAIText（generate-remedial / analyze-weak-points 等公開端點共用）', () => {
  it('未登入 + Gemini 失敗（無 Grok / OpenAI）→ 不補打 Claude，直接拋錯', async () => {
    asAnonymous();
    vi.stubEnv('OPENAI_API_KEY', '');
    geminiFails();
    anthropicStream.mockReturnValue({ finalMessage: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'x' }] }) });
    const { generateAIText } = await import('@/lib/ai/textModel');

    await expect(generateAIText({ prompt: '補強題' })).rejects.toThrow();
    expect(claudeCallCount()).toBe(0);
  });

  it('Free 登入 + Gemini 失敗 → 不補打 Claude', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    geminiFails();
    anthropicStream.mockReturnValue({ finalMessage: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'x' }] }) });
    const { generateAIText } = await import('@/lib/ai/textModel');

    await expect(generateAIText({ prompt: '補強題' })).rejects.toThrow();
    expect(claudeCallCount()).toBe(0);
  });

  it('Pro → 照舊首選 Claude', async () => {
    asPro();
    anthropicStream.mockReturnValue({ finalMessage: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }) });
    const { generateAIText } = await import('@/lib/ai/textModel');

    const result = await generateAIText({ prompt: '補強題' });

    expect(result.usedModel).toBe('claude');
    expect(claudeCallCount()).toBe(1);
  });
});
