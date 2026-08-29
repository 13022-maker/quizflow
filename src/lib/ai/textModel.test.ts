import { describe, expect, it, vi } from 'vitest';

import { buildClaudeMediaBlocks, buildGeminiMediaParts, isRetryableAIError, resolveAIProvider, withAIRetry } from './textModel';

describe('resolveAIProvider', () => {
  it('付費且有 Claude 金鑰 → claude', () => {
    expect(resolveAIProvider(true, true)).toBe('claude');
  });

  it('付費但無 Claude 金鑰 → gemini', () => {
    expect(resolveAIProvider(true, false)).toBe('gemini');
  });

  it('免費即使有金鑰 → gemini', () => {
    expect(resolveAIProvider(false, true)).toBe('gemini');
  });

  it('免費且無金鑰 → gemini', () => {
    expect(resolveAIProvider(false, false)).toBe('gemini');
  });
});

describe('isRetryableAIError', () => {
  it('status 429（限流）可重試', () => {
    expect(isRetryableAIError({ status: 429 })).toBe(true);
  });

  it('status 529（Anthropic 過載）可重試', () => {
    expect(isRetryableAIError({ status: 529 })).toBe(true);
  });

  it('status 500 以上（伺服器錯誤）可重試', () => {
    expect(isRetryableAIError({ status: 500 })).toBe(true);
    expect(isRetryableAIError({ status: 503 })).toBe(true);
  });

  it('code 429（部分 SDK 用 code 而非 status）可重試', () => {
    expect(isRetryableAIError({ code: 429 })).toBe(true);
  });

  it('錯誤訊息含 overloaded 可重試', () => {
    expect(isRetryableAIError(new Error('model is overloaded, try again later'))).toBe(true);
  });

  it('status 400（請求本身有問題）不可重試', () => {
    expect(isRetryableAIError({ status: 400 })).toBe(false);
  });

  it('status 401/403（金鑰或權限問題）不可重試，重試也不會變好', () => {
    expect(isRetryableAIError({ status: 401 })).toBe(false);
    expect(isRetryableAIError({ status: 403 })).toBe(false);
  });

  it('一般錯誤（無 status、訊息不含 overloaded）不可重試', () => {
    expect(isRetryableAIError(new Error('AI 回傳格式無 JSON'))).toBe(false);
  });

  it('非 Error 物件、無 status/code 屬性不會炸，回傳 false', () => {
    expect(isRetryableAIError('plain string error')).toBe(false);
    expect(isRetryableAIError(null)).toBe(false);
    expect(isRetryableAIError(undefined)).toBe(false);
  });
});

describe('withAIRetry', () => {
  it('第一次就成功：直接回傳結果，不重試', async () => {
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await withAIRetry(fn, { maxRetries: 3, delayMs: 0 });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('可重試錯誤：失敗兩次後第三次成功，最終回傳成功結果', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ status: 429 })
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce('ok');

    const result = await withAIRetry(fn, { maxRetries: 3, delayMs: 0 });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('不可重試錯誤：第一次失敗就立刻拋出，不會再試第二次', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 400 });

    await expect(withAIRetry(fn, { maxRetries: 3, delayMs: 0 })).rejects.toEqual({ status: 400 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('可重試錯誤但一直失敗：試滿 maxRetries 次後拋出最後一次的錯誤', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 429 });

    await expect(withAIRetry(fn, { maxRetries: 3, delayMs: 0 })).rejects.toEqual({ status: 429 });
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('buildClaudeMediaBlocks', () => {
  it('圖片 mimeType（image/ 開頭）轉成 Claude image block', () => {
    const blocks = buildClaudeMediaBlocks([
      { mimeType: 'image/png', base64: 'AAAA' },
    ]);

    expect(blocks).toEqual([
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
      },
    ]);
  });

  it('非 image/ 開頭的 mimeType 轉成 Claude document block（PDF）', () => {
    const blocks = buildClaudeMediaBlocks([
      { mimeType: 'application/pdf', base64: 'BBBB' },
    ]);

    expect(blocks).toEqual([
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: 'BBBB' },
      },
    ]);
  });

  it('多份 media 依原順序轉成多個 blocks', () => {
    const blocks = buildClaudeMediaBlocks([
      { mimeType: 'image/jpeg', base64: 'A' },
      { mimeType: 'image/png', base64: 'B' },
    ]);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ source: { data: 'A' } });
    expect(blocks[1]).toMatchObject({ source: { data: 'B' } });
  });

  it('空陣列回傳空陣列', () => {
    expect(buildClaudeMediaBlocks([])).toEqual([]);
  });
});

describe('buildGeminiMediaParts', () => {
  it('每份 media 轉成一個 inlineData part', () => {
    const parts = buildGeminiMediaParts([
      { mimeType: 'application/pdf', base64: 'CCCC' },
    ]);

    expect(parts).toEqual([
      { inlineData: { mimeType: 'application/pdf', data: 'CCCC' } },
    ]);
  });

  it('多份 media 依原順序轉成多個 parts', () => {
    const parts = buildGeminiMediaParts([
      { mimeType: 'image/png', base64: 'A' },
      { mimeType: 'image/png', base64: 'B' },
    ]);

    expect(parts).toEqual([
      { inlineData: { mimeType: 'image/png', data: 'A' } },
      { inlineData: { mimeType: 'image/png', data: 'B' } },
    ]);
  });

  it('空陣列回傳空陣列', () => {
    expect(buildGeminiMediaParts([])).toEqual([]);
  });
});
