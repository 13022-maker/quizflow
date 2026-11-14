import { describe, expect, it } from 'vitest';

import { parseCodeBlocks } from '../codeBlock';
import { buildCodeSnippetRule } from './codeSnippetPrompt';

describe('buildCodeSnippetRule', () => {
  it('預設欄位為 question，並說明是「不要 markdown」的例外', () => {
    const rule = buildCodeSnippetRule();

    expect(rule).toContain('"question": "下列 C++ 程式執行後的輸出為何？');
    expect(rule).toContain('唯一例外');
    expect(rule).toContain('```cpp');
  });

  it('可指定欄位名稱（bloom-studio 用 content）', () => {
    expect(buildCodeSnippetRule('content')).toContain('"content": "');
  });

  it('範例本身是合法 JSON，解析後的題目文字能被 parseCodeBlocks 切出 cpp 程式碼', () => {
    const rule = buildCodeSnippetRule();
    const line = rule.split('\n').find(l => l.startsWith('"question":'))!;
    const parsed = JSON.parse(`{${line}}`) as { question: string };
    const segments = parseCodeBlocks(parsed.question);

    expect(segments[0]).toEqual({ kind: 'text', text: '下列 C++ 程式執行後的輸出為何？' });
    expect(segments[1]).toMatchObject({ kind: 'code', lang: 'cpp' });
    expect((segments[1] as { code: string }).code).toContain('    int x = 3;');
  });
});
