import { describe, expect, it } from 'vitest';

import { buildClozeCausalChainNote } from './clozeNote';

describe('buildClozeCausalChainNote', () => {
  it('沒有勾選 cloze 時回傳空字串（不影響其他題型的 prompt）', () => {
    expect(buildClozeCausalChainNote(['mc', 'tf'])).toBe('');
  });

  it('勾選 cloze 時要求用「但是/因此」因果鏈，禁止「然後」流水帳', () => {
    const note = buildClozeCausalChainNote(['cloze']);

    expect(note).toContain('但是');
    expect(note).toContain('因此');
    expect(note).toMatch(/不要|禁止/);
    expect(note).toContain('然後');
  });

  it('cloze 跟其他題型一起勾選時仍會加上規則', () => {
    const note = buildClozeCausalChainNote(['mc', 'cloze', 'short']);

    expect(note).not.toBe('');
  });
});
