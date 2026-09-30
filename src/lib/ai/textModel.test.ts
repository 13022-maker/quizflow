import { describe, expect, it, vi } from 'vitest';

import { buildClaudeMediaBlocks, buildGeminiMediaParts, callWithKeyPool, getApiKeyPool, isRetryableAIError, resolveAIProvider, shouldFallbackToClaudeAfterGemini, withAIRetry } from './textModel';

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

describe('shouldFallbackToClaudeAfterGemini', () => {
  it('免費方案（provider=gemini）+ 有 Claude 金鑰 + 沒 forceGemini → 應該補打 Claude', () => {
    expect(shouldFallbackToClaudeAfterGemini({}, 'gemini', true)).toBe(true);
  });

  it('forceGemini=true（呼叫端主動控成本，例如生成學科避免試用戶燒 Opus）→ 即使有金鑰也不補打', () => {
    expect(shouldFallbackToClaudeAfterGemini({ forceGemini: true }, 'gemini', true)).toBe(false);
  });

  it('沒有設定 Claude 金鑰 → 沒得補打', () => {
    expect(shouldFallbackToClaudeAfterGemini({}, 'gemini', false)).toBe(false);
  });

  it('provider=claude（代表這次呼叫已經試過 Claude 了）→ 不重複補打，避免無意義的第二次嘗試', () => {
    expect(shouldFallbackToClaudeAfterGemini({}, 'claude', true)).toBe(false);
  });
});

describe('getApiKeyPool', () => {
  it('只有主帳號 key，沒有備用：回傳單一元素陣列', () => {
    expect(getApiKeyPool('primary-key', undefined)).toEqual(['primary-key']);
  });

  it('主帳號 + 備用（逗號分隔）：依序組成陣列，主帳號在前', () => {
    expect(getApiKeyPool('primary-key', 'backup-1,backup-2')).toEqual([
      'primary-key',
      'backup-1',
      'backup-2',
    ]);
  });

  it('備用清單有多餘空白：每組都要 trim', () => {
    expect(getApiKeyPool('primary-key', ' backup-1 , backup-2 ')).toEqual([
      'primary-key',
      'backup-1',
      'backup-2',
    ]);
  });

  it('沒有主帳號 key，只有備用：不補空字串進陣列', () => {
    expect(getApiKeyPool(undefined, 'backup-1')).toEqual(['backup-1']);
  });

  it('主帳號跟備用都沒設：回傳空陣列', () => {
    expect(getApiKeyPool(undefined, undefined)).toEqual([]);
  });

  it('備用清單裡有空白項目（例如結尾多一個逗號）：過濾掉空字串', () => {
    expect(getApiKeyPool('primary-key', 'backup-1,,')).toEqual(['primary-key', 'backup-1']);
  });
});

describe('callWithKeyPool', () => {
  it('第一組 key 就成功：直接回傳結果，不會嘗試其他 key', async () => {
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await callWithKeyPool(['key-1', 'key-2'], fn);

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('key-1');
  });

  it('第一組失敗、第二組成功：換下一組 key 重試，回傳成功結果', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('key-1 額度用完'))
      .mockResolvedValueOnce('ok');

    const result = await callWithKeyPool(['key-1', 'key-2'], fn);

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, 'key-1');
    expect(fn).toHaveBeenNthCalledWith(2, 'key-2');
  });

  it('所有 key 都失敗：拋出最後一組 key 的錯誤', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('key-1 失敗'))
      .mockRejectedValueOnce(new Error('key-2 失敗'));

    await expect(callWithKeyPool(['key-1', 'key-2'], fn)).rejects.toThrow('key-2 失敗');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('key pool 是空陣列：直接拋出明確錯誤，不呼叫 fn', async () => {
    const fn = vi.fn();

    await expect(callWithKeyPool([], fn)).rejects.toThrow('AI 服務未設定');
    expect(fn).not.toHaveBeenCalled();
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
