import { describe, expect, it } from 'vitest';

import { formatAiUsageMessage } from './aiUsageMessage';

describe('formatAiUsageMessage', () => {
  it('Pro / VIP（quota 999）回傳 Pro 固定文案、無警示', () => {
    // Pro 分支 getAiUsageRemaining 短路不查 DB,used 永遠為 0,
    // 所以文案不依賴 used 計數
    const result = formatAiUsageMessage({ quota: 999, used: 0, remaining: 999 });

    expect(result.text).toBe('Pro 無上限,盡情創作 ✨');
    expect(result.isWarning).toBe(false);
  });

  it('Free 充裕（剩 > 2 次）回傳一般文案、無警示', () => {
    const result = formatAiUsageMessage({ quota: 10, used: 3, remaining: 7 });

    expect(result.text).toBe('本月 3 / 10 次 · 還剩 7 次');
    expect(result.isWarning).toBe(false);
  });

  it('Free 低額（剩 = 2 次）回傳警示文案 + 升級提示', () => {
    const result = formatAiUsageMessage({ quota: 10, used: 8, remaining: 2 });

    expect(result.text).toBe('本月 8 / 10 次 · 只剩 2 次,升級 Pro 解鎖無限');
    expect(result.isWarning).toBe(true);
  });

  it('Free 低額（剩 = 1 次）回傳警示文案 + 升級提示', () => {
    const result = formatAiUsageMessage({ quota: 10, used: 9, remaining: 1 });

    expect(result.text).toBe('本月 9 / 10 次 · 只剩 1 次,升級 Pro 解鎖無限');
    expect(result.isWarning).toBe(true);
  });
});
