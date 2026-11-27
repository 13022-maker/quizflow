import { describe, expect, it, vi } from 'vitest';

import {
  AIDeadlineError,
  callWithDeadline,
  canStartAttempt,
  createDeadline,
  isAbortLikeError,
} from './aiDeadline';

/** 可手動推進的假時鐘：sleep 直接把時間往前推，不真的等 */
function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

const retryable = (err: unknown) => (err as { status?: number }).status === 503;

function httpError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

describe('createDeadline', () => {
  it('剩餘時間 = 預算 − 已經過時間，過期後為 0 不為負', () => {
    const clock = fakeClock();
    const d = createDeadline(270_000, clock.now);

    expect(d.remainingMs()).toBe(270_000);

    clock.advance(100_000);

    expect(d.elapsedMs()).toBe(100_000);
    expect(d.remainingMs()).toBe(170_000);

    clock.advance(500_000);

    expect(d.remainingMs()).toBe(0);
  });
});

describe('canStartAttempt', () => {
  it('扣掉 backoff 後剩餘時間 ≥ 最小可用時間才允許', () => {
    const clock = fakeClock();
    const d = createDeadline(60_000, clock.now);

    expect(canStartAttempt(d, { minAttemptMs: 20_000 })).toBe(true);
    expect(canStartAttempt(d, { minAttemptMs: 20_000, delayMs: 40_000 })).toBe(true);
    expect(canStartAttempt(d, { minAttemptMs: 20_000, delayMs: 40_001 })).toBe(false);
  });
});

describe('isAbortLikeError', () => {
  it('辨識 AbortSignal.timeout / 手動 abort / Anthropic SDK 的中斷與逾時錯誤', () => {
    expect(isAbortLikeError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(true);
    expect(isAbortLikeError(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe(true);
    expect(isAbortLikeError(Object.assign(new Error('x'), { name: 'APIUserAbortError' }))).toBe(true);
    expect(isAbortLikeError(Object.assign(new Error('x'), { name: 'APIConnectionTimeoutError' }))).toBe(true);
    expect(isAbortLikeError(httpError(503))).toBe(false);
    expect(isAbortLikeError('nope')).toBe(false);
  });
});

describe('callWithDeadline', () => {
  const base = { maxRetries: 3, baseDelayMs: 1500, attemptCapMs: 150_000, minAttemptMs: 20_000, isRetryable: retryable };

  it('第一次成功就直接回傳，單次 timeout = min(剩餘, 單次上限)', async () => {
    const clock = fakeClock();
    const deadline = createDeadline(270_000, clock.now);
    const fn = vi.fn(async (_signal: AbortSignal, timeoutMs: number) => `ok:${timeoutMs}`);

    await expect(callWithDeadline(fn, { ...base, deadline, sleep: clock.sleep })).resolves.toBe('ok:150000');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('單次 timeout 不超過剩餘預算', async () => {
    const clock = fakeClock();
    const deadline = createDeadline(270_000, clock.now);
    clock.advance(200_000); // 只剩 70s
    const fn = vi.fn(async (_s: AbortSignal, timeoutMs: number) => timeoutMs);

    await expect(callWithDeadline(fn, { ...base, deadline, sleep: clock.sleep })).resolves.toBe(70_000);
  });

  it('可重試錯誤：遞增 backoff（1.5s、3s）後成功', async () => {
    const clock = fakeClock();
    const deadline = createDeadline(270_000, clock.now);
    const fn = vi.fn()
      .mockRejectedValueOnce(httpError(503))
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce('ok');

    await expect(callWithDeadline(fn, { ...base, deadline, sleep: clock.sleep })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(deadline.elapsedMs()).toBe(4_500);
  });

  it('不可重試錯誤：立即拋出原錯誤', async () => {
    const clock = fakeClock();
    const deadline = createDeadline(270_000, clock.now);
    const err = httpError(400);
    const fn = vi.fn().mockRejectedValue(err);

    await expect(callWithDeadline(fn, { ...base, deadline, sleep: clock.sleep })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('重試次數用完：拋出最後一次的原錯誤', async () => {
    const clock = fakeClock();
    const deadline = createDeadline(270_000, clock.now);
    const err = httpError(503);
    const fn = vi.fn().mockRejectedValue(err);

    await expect(callWithDeadline(fn, { ...base, deadline, sleep: clock.sleep })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('可重試錯誤但剩餘預算不夠再打一次：不重試，拋出原錯誤（不硬撐到被平台砍掉）', async () => {
    const clock = fakeClock();
    const deadline = createDeadline(60_000, clock.now);
    const err = httpError(503);
    const fn = vi.fn(async () => {
      clock.advance(45_000); // 這次呼叫花了 45s 才回 503，只剩 15s < 20s 最小可用時間
      throw err;
    });

    await expect(callWithDeadline(fn, { ...base, deadline, sleep: clock.sleep })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('一開始剩餘預算就不足：不呼叫，直接拋 AIDeadlineError', async () => {
    const clock = fakeClock();
    const deadline = createDeadline(60_000, clock.now);
    clock.advance(50_000);
    const fn = vi.fn();

    await expect(callWithDeadline(fn, { ...base, deadline, sleep: clock.sleep })).rejects.toBeInstanceOf(AIDeadlineError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('呼叫被 abort（逾時）且預算已不足：拋 AIDeadlineError，cause 保留原錯誤', async () => {
    const clock = fakeClock();
    const deadline = createDeadline(270_000, clock.now);
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fn = vi.fn(async () => {
      clock.advance(260_000);
      throw abortErr;
    });

    const p = callWithDeadline(fn, { ...base, deadline, sleep: clock.sleep });

    await expect(p).rejects.toBeInstanceOf(AIDeadlineError);
    await expect(p).rejects.toMatchObject({ cause: abortErr });
  });

  it('單次呼叫卡到單次上限被 abort、但總預算還夠：再試一次', async () => {
    const clock = fakeClock();
    const deadline = createDeadline(270_000, clock.now);
    const abortErr = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    const fn = vi.fn()
      .mockImplementationOnce(async () => {
        clock.advance(150_000);
        throw abortErr;
      })
      .mockImplementationOnce(async (_s: AbortSignal, timeoutMs: number) => timeoutMs);

    // 第二次：剩 270 − 150 − 1.5 = 118.5s
    await expect(callWithDeadline(fn, { ...base, deadline, sleep: clock.sleep })).resolves.toBe(118_500);
  });

  it('每次都被 abort 到次數用完：拋 AIDeadlineError（不是裸的 AbortError）', async () => {
    const clock = fakeClock();
    const deadline = createDeadline(270_000, clock.now);
    const fn = vi.fn(async () => {
      clock.advance(10_000);
      throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    });

    await expect(callWithDeadline(fn, { ...base, deadline, sleep: clock.sleep })).rejects.toBeInstanceOf(AIDeadlineError);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
