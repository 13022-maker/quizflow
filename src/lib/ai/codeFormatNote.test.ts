import { describe, expect, it } from 'vitest';

import { CODE_FORMAT_NOTE } from './codeFormatNote';

describe('CODE_FORMAT_NOTE', () => {
  it('要求程式碼用 fenced code block 並標註語言', () => {
    expect(CODE_FORMAT_NOTE).toContain('```c');
    expect(CODE_FORMAT_NOTE).toContain('```cpp');
    expect(CODE_FORMAT_NOTE).toContain('```python');
    expect(CODE_FORMAT_NOTE).toMatch(/換行與縮排/);
  });

  it('涵蓋題幹、選項、詳解三個欄位', () => {
    expect(CODE_FORMAT_NOTE).toContain('question');
    expect(CODE_FORMAT_NOTE).toContain('options');
    expect(CODE_FORMAT_NOTE).toContain('explanation');
  });

  it('提醒 JSON 字串內換行要 escape 成 \\n，且整份回應本身仍不可包 markdown', () => {
    expect(CODE_FORMAT_NOTE).toContain('\\n');
    expect(CODE_FORMAT_NOTE).toMatch(/整份回應/);
  });

  it('短的行內片段用單反引號', () => {
    expect(CODE_FORMAT_NOTE).toMatch(/單反引號/);
  });
});
