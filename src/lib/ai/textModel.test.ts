import { describe, expect, it } from 'vitest';

import { resolveAIProvider } from './textModel';

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
