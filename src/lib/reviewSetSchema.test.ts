import { describe, expect, it } from 'vitest';

import { SampleInputSchema } from './reviewSetSchema';

const VALID_REF = { correctness: 3, completeness: 3, clarity: 3, creativity: 3 };

describe('SampleInputSchema — isAiAnswer', () => {
  it('省略 isAiAnswer 時預設為 false（向後相容舊資料/舊表單）', () => {
    const parsed = SampleInputSchema.parse({ content: '測試內容', ref: VALID_REF });

    expect(parsed.isAiAnswer).toBe(false);
  });

  it('可以明確傳 true', () => {
    const parsed = SampleInputSchema.parse({ content: '測試內容', ref: VALID_REF, isAiAnswer: true });

    expect(parsed.isAiAnswer).toBe(true);
  });
});
