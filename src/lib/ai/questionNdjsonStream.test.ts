import { beforeEach, describe, expect, it, vi } from 'vitest';

import { questionNdjsonResponse, type StreamChunk } from './questionNdjsonStream';

const RESULT = JSON.stringify({
  title: '光合作用',
  questions: [
    { type: 'mc', question: 'Q1', answer: 'A' },
    { type: 'mc', question: 'Q2', answer: 'B' },
  ],
});

function chunks(text: string, size: number, finishReason = 'STOP'): AsyncIterable<StreamChunk> {
  const parts: StreamChunk[] = [];
  for (let i = 0; i < text.length; i += size) {
    parts.push({ text: text.slice(i, i + size) });
  }
  parts[parts.length - 1]!.candidates = [{ finishReason }];
  return (async function* () {
    yield * parts;
  })();
}

async function events(res: Response) {
  return (await res.text()).trim().split('\n').map(l => JSON.parse(l));
}

const base = {
  logTag: 'test',
  postProcess: (q: Record<string, unknown>) => ({ ...q, processed: true }),
  errorMessage: (e: unknown) => (e instanceof Error ? `錯：${e.message}` : '錯'),
};

describe('questionNdjsonResponse', () => {
  beforeEach(() => {
    // helper 在 fallback / 失敗時會寫 log，測試裡靜音（vitest-fail-on-console）
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('primary 串流：title → 逐題（經過 postProcess）→ done', async () => {
    const res = questionNdjsonResponse({ ...base, primary: async () => chunks(RESULT, 9) });

    expect(res.headers.get('content-type')).toContain('application/x-ndjson');

    const ev = await events(res);

    expect(ev.map(e => e.type)).toEqual(['title', 'question', 'question', 'done']);
    expect(ev[1].question).toEqual({ type: 'mc', question: 'Q1', answer: 'A', processed: true });
    expect(ev[3]).toEqual({ type: 'done', count: 2, model: 'primary' });
  });

  it('串流中途截斷：保留已出題目 + warning，不呼叫 fallback', async () => {
    const fallback = vi.fn();
    const cut = RESULT.slice(0, RESULT.indexOf('"Q2"'));
    const ev = await events(questionNdjsonResponse({ ...base, primary: async () => chunks(cut, 7, 'MAX_TOKENS'), fallback }));

    expect(ev.map(e => e.type)).toEqual(['title', 'question', 'warning', 'done']);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('primary 一題都沒出 → 走 fallback，一次推完', async () => {
    const ev = await events(questionNdjsonResponse({
      ...base,
      primary: async () => {
        throw new Error('503');
      },
      fallback: async () => ({ raw: `前言 ${RESULT} 後記`, usedModel: 'claude' }),
    }));

    expect(ev.map(e => e.type)).toEqual(['title', 'question', 'question', 'done']);
    expect(ev[3].model).toBe('claude');
  });

  it('shouldFallback 回 false 時不走 fallback，直接回 error 事件', async () => {
    const fallback = vi.fn();
    const ev = await events(questionNdjsonResponse({
      ...base,
      primary: async () => {
        throw new Error('PERMISSION_DENIED');
      },
      fallback,
      shouldFallback: () => false,
    }));

    expect(ev).toEqual([{ type: 'error', error: '錯：PERMISSION_DENIED' }]);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('沒有 primary 時直接用 fallback（例如老師選 Claude）', async () => {
    const ev = await events(questionNdjsonResponse({
      ...base,
      fallback: async () => ({ raw: RESULT, usedModel: 'claude' }),
    }));

    expect(ev.at(-1)).toEqual({ type: 'done', count: 2, model: 'claude' });
  });

  it('fallback 回傳非 JSON → error 事件', async () => {
    const ev = await events(questionNdjsonResponse({
      ...base,
      fallback: async () => ({ raw: '抱歉我無法出題', usedModel: 'claude' }),
    }));

    expect(ev).toEqual([{ type: 'error', error: 'AI 回傳格式錯誤，請重試' }]);
  });

  it('primary 正常結束但 0 題 → 視為失敗走 fallback', async () => {
    const ev = await events(questionNdjsonResponse({
      ...base,
      primary: async () => chunks('{"title":"T","questions":[]}', 5),
      fallback: async () => ({ raw: RESULT, usedModel: 'claude' }),
    }));

    expect(ev.filter(e => e.type === 'title')).toHaveLength(1);
    expect(ev.at(-1)).toEqual({ type: 'done', count: 2, model: 'claude' });
  });
});
