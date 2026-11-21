import { describe, expect, it } from 'vitest';

import { createFixedWindowLimiter } from './practicePageRateLimit';

describe('createFixedWindowLimiter', () => {
  it('同一個 key 在視窗內超過上限就擋，換視窗後重新計算', () => {
    let now = 1_000_000;
    const limiter = createFixedWindowLimiter({ limit: 3, windowMs: 60_000, now: () => now });

    expect(limiter.hit('a')).toBe(true);
    expect(limiter.hit('a')).toBe(true);
    expect(limiter.hit('a')).toBe(true);
    expect(limiter.hit('a')).toBe(false);
    // 不同 key 互不影響
    expect(limiter.hit('b')).toBe(true);

    now += 60_001;

    expect(limiter.hit('a')).toBe(true);
  });

  it('key 數量超過上限時會清掉過期的項目，避免記憶體無限長大', () => {
    let now = 0;
    const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 1000, now: () => now, maxKeys: 2 });
    limiter.hit('a');
    limiter.hit('b');
    now = 5000;
    limiter.hit('c');

    expect(limiter.size()).toBe(1);
  });
});
