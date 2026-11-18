/**
 * generate-from-file 時間預算：AI 呼叫要帶 AbortSignal、不疊 SDK 內建重試，
 * 預算快用完時 route 自己回 504 JSON（繁中訊息），而不是被 Vercel maxDuration 砍掉回非 JSON。
 *
 * 背景：2026-11-18 production / preview 多次 "Task timed out after 60 seconds"，老師只看到「命題失敗」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  return { isPro: false };
});

const geminiGenerate = vi.hoisted(() => vi.fn());
const anthropicCreate = vi.hoisted(() => vi.fn());

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: 'user_test' }),
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

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: (...args: unknown[]) => geminiGenerate(...args) };
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: (...args: unknown[]) => anthropicCreate(...args) };
  },
}));

const QUESTIONS_JSON = JSON.stringify({
  title: '直流電路',
  questions: [{ type: 'mc', question: '題目', options: ['(A)甲', '(B)乙', '(C)丙', '(D)丁'], answer: 'A', explanation: '說明' }],
});

function imageRequest(extra: Record<string, string> = {}): Request {
  const fd = new FormData();
  fd.append('file', new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'p.png', { type: 'image/png' }));
  fd.append('types', '["mc"]');
  fd.append('count', '1');
  for (const [k, v] of Object.entries(extra)) {
    fd.append(k, v);
  }
  return new Request('http://localhost/api/ai/generate-from-file', { method: 'POST', body: fd });
}

/** 把系統時間往後推 ms（只 fake Date，setTimeout / AbortSignal 照常） */
function elapse(ms: number) {
  vi.setSystemTime(Date.now() + ms);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  geminiGenerate.mockReset();
  anthropicCreate.mockReset();
  state.isPro = false;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('generate-from-file 時間預算', () => {
  it('maxDuration 提高到 Vercel Hobby + Fluid compute 上限 300 秒', async () => {
    const mod = await import('./route');

    expect(mod.maxDuration).toBe(300);
  });

  it('Gemini 呼叫帶 abortSignal 與 httpOptions.timeout', async () => {
    geminiGenerate.mockResolvedValue({ text: QUESTIONS_JSON, candidates: [{ finishReason: 'STOP' }] });
    const { POST } = await import('./route');

    const res = await POST(imageRequest());

    expect(res.status).toBe(200);

    const config = geminiGenerate.mock.calls[0]![0].config;

    expect(config.abortSignal).toBeInstanceOf(AbortSignal);
    expect(config.httpOptions.timeout).toBeGreaterThan(0);
  });

  it('Claude 呼叫帶 signal / timeout，且關掉 SDK 內建重試（maxRetries: 0，避免 3×3 次疊加）', async () => {
    state.isPro = true;
    anthropicCreate.mockResolvedValue({ content: [{ type: 'text', text: QUESTIONS_JSON }], stop_reason: 'end_turn' });
    const { POST } = await import('./route');

    const res = await POST(imageRequest({ model: 'claude' }));

    expect(res.status).toBe(200);

    const reqOptions = anthropicCreate.mock.calls[0]![1];

    expect(reqOptions.maxRetries).toBe(0);
    expect(reqOptions.signal).toBeInstanceOf(AbortSignal);
    expect(reqOptions.timeout).toBeGreaterThan(0);
  });

  it('AI 呼叫逾時被 abort、預算也用完 → 504 JSON + 繁中逾時訊息', async () => {
    geminiGenerate.mockImplementation(async () => {
      elapse(265_000);
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    });
    const { POST } = await import('./route');

    const res = await POST(imageRequest());

    expect(res.status).toBe(504);

    const body = await res.json();

    expect(body.error).toBe('AI 回應逾時，請減少頁數或題數後再試');
    expect(body.retryable).toBe(true);
  });

  it('Pro + Gemini 截斷但剩餘預算不夠 Claude 整份重出 → 不打 Claude，直接回截斷訊息', async () => {
    state.isPro = true;
    geminiGenerate.mockImplementation(async () => {
      elapse(240_000);
      return { text: '{"questions":[', candidates: [{ finishReason: 'MAX_TOKENS' }] };
    });
    const { POST } = await import('./route');

    const res = await POST(imageRequest());

    expect(anthropicCreate).not.toHaveBeenCalled();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain('截斷');
  });
});
