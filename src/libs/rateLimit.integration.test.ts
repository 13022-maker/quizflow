// 限流整合測試：真實 Postgres upsert（無 DATABASE_URL 時 src/libs/DB.ts 自動用 in-memory PGlite）。
import { describe, expect, it } from 'vitest';

import { checkRateLimit, enforcePublicAiLimit, getClientIp, PUBLIC_AI_LIMITS } from './rateLimit';

const T0 = new Date('2026-10-21T00:00:00.000Z'); // 剛好落在 600 秒視窗起點

describe('checkRateLimit', () => {
  it('上限內放行，第 limit+1 次擋下', async () => {
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await checkRateLimit('t-basic', '1.1.1.1', 3, 600, T0));
    }

    expect(results.map(r => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map(r => r.count)).toEqual([1, 2, 3, 4]);
  });

  it('不同 IP、不同 bucket 各自計數', async () => {
    await checkRateLimit('t-iso', '2.2.2.2', 1, 600, T0);

    expect((await checkRateLimit('t-iso', '3.3.3.3', 1, 600, T0)).allowed).toBe(true);
    expect((await checkRateLimit('t-iso-other', '2.2.2.2', 1, 600, T0)).allowed).toBe(true);
    expect((await checkRateLimit('t-iso', '2.2.2.2', 1, 600, T0)).allowed).toBe(false);
  });

  it('進入下一個視窗就重新計數；retryAfter 是到視窗結束的秒數', async () => {
    const atStart = await checkRateLimit('t-window', '4.4.4.4', 1, 600, T0);
    const blocked = await checkRateLimit('t-window', '4.4.4.4', 1, 600, new Date(T0.getTime() + 590_000));
    const nextWindow = await checkRateLimit('t-window', '4.4.4.4', 1, 600, new Date(T0.getTime() + 600_000));

    expect(atStart.retryAfterSec).toBe(600);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(10);
    expect(nextWindow.allowed).toBe(true);
  });

  it('同時大量請求不會少算（原子 upsert）', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => checkRateLimit('t-race', '5.5.5.5', 10, 600, T0)),
    );

    expect(results.filter(r => r.allowed)).toHaveLength(10);
    expect(Math.max(...results.map(r => r.count))).toBe(20);
  });
});

describe('getClientIp', () => {
  it('取 x-forwarded-for 第一個 IP', () => {
    const req = new Request('http://x', { headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' } });

    expect(getClientIp(req)).toBe('9.9.9.9');
  });

  it('沒有 header 時回 unknown', () => {
    expect(getClientIp(new Request('http://x'))).toBe('unknown');
  });
});

describe('enforcePublicAiLimit', () => {
  it('超過上限回 429 與 Retry-After', async () => {
    const { limit } = PUBLIC_AI_LIMITS['generate-flashcards'];
    const req = () => new Request('http://x', { headers: { 'x-forwarded-for': '6.6.6.6' } });
    for (let i = 0; i < limit; i++) {
      expect(await enforcePublicAiLimit(req(), 'generate-flashcards')).toBeNull();
    }
    const res = await enforcePublicAiLimit(req(), 'generate-flashcards');

    expect(res?.status).toBe(429);
    expect(Number(res?.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
});
