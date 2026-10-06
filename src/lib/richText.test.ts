import { describe, expect, it } from 'vitest';

import { hasCodeBlock, parseInlineCode, parseRichText, toPlainText } from './richText';

describe('parseRichText', () => {
  it('沒有 code fence 時回傳單一 text 區塊（舊資料原樣保留）', () => {
    expect(parseRichText('下列何者為 C 語言的關鍵字？')).toEqual([
      { kind: 'text', text: '下列何者為 C 語言的關鍵字？' },
    ]);
  });

  it('空字串回傳空陣列', () => {
    expect(parseRichText('')).toEqual([]);
  });

  it('解析帶語言標記的 fenced code block，保留換行與縮排', () => {
    const input = '下列程式的輸出為何？\n```c\n#include <stdio.h>\nint main() {\n    printf("%d", 1 + 2);\n    return 0;\n}\n```';

    expect(parseRichText(input)).toEqual([
      { kind: 'text', text: '下列程式的輸出為何？' },
      {
        kind: 'code',
        lang: 'c',
        code: '#include <stdio.h>\nint main() {\n    printf("%d", 1 + 2);\n    return 0;\n}',
      },
    ]);
  });

  it('程式碼區塊後面的文字也要保留', () => {
    const input = '```cpp\nint x = 5;\n```\n請問 x 的值？';

    expect(parseRichText(input)).toEqual([
      { kind: 'code', lang: 'cpp', code: 'int x = 5;' },
      { kind: 'text', text: '請問 x 的值？' },
    ]);
  });

  it('多個 fence 依序解析', () => {
    const input = '比較兩段程式：\n```python\nprint(1)\n```\n與\n```js\nconsole.log(1)\n```\n何者正確？';

    expect(parseRichText(input)).toEqual([
      { kind: 'text', text: '比較兩段程式：' },
      { kind: 'code', lang: 'python', code: 'print(1)' },
      { kind: 'text', text: '與' },
      { kind: 'code', lang: 'js', code: 'console.log(1)' },
      { kind: 'text', text: '何者正確？' },
    ]);
  });

  it('沒有語言標記的 fence 仍是程式碼區塊，lang 為空字串', () => {
    expect(parseRichText('```\na = 1\n```')).toEqual([
      { kind: 'code', lang: '', code: 'a = 1' },
    ]);
  });

  it('fence 開頭那行不是語言名稱時（例如含空白），整行視為程式碼內容', () => {
    expect(parseRichText('```int a = 1;\nint b = 2;\n```')).toEqual([
      { kind: 'code', lang: '', code: 'int a = 1;\nint b = 2;' },
    ]);
  });

  it('單行 fence（```code```）解析為程式碼區塊', () => {
    expect(parseRichText('輸出為何：```printf("hi");```')).toEqual([
      { kind: 'text', text: '輸出為何：' },
      { kind: 'code', lang: '', code: 'printf("hi");' },
    ]);
  });

  it('未閉合的 fence：其後全部內容視為程式碼（AI 輸出被截斷時仍可讀）', () => {
    expect(parseRichText('題目：\n```c\nint main() {\n    return 0;')).toEqual([
      { kind: 'text', text: '題目：' },
      { kind: 'code', lang: 'c', code: 'int main() {\n    return 0;' },
    ]);
  });

  it('只有一個孤立的 ``` 且後面沒有內容時不產生空區塊', () => {
    expect(parseRichText('文字```')).toEqual([
      { kind: 'text', text: '文字' },
    ]);
  });

  it('處理 Windows 換行（\\r\\n）', () => {
    expect(parseRichText('A\r\n```c\r\nint x;\r\n```\r\nB')).toEqual([
      { kind: 'text', text: 'A' },
      { kind: 'code', lang: 'c', code: 'int x;' },
      { kind: 'text', text: 'B' },
    ]);
  });
});

describe('parseInlineCode', () => {
  it('沒有反引號時回傳單一 text 片段', () => {
    expect(parseInlineCode('一般文字')).toEqual([{ kind: 'text', text: '一般文字' }]);
  });

  it('解析行內 code', () => {
    expect(parseInlineCode('變數 `count` 的初始值為 `0`。')).toEqual([
      { kind: 'text', text: '變數 ' },
      { kind: 'code', text: 'count' },
      { kind: 'text', text: ' 的初始值為 ' },
      { kind: 'code', text: '0' },
      { kind: 'text', text: '。' },
    ]);
  });

  it('未成對的反引號維持原樣', () => {
    expect(parseInlineCode('單一個 ` 反引號')).toEqual([{ kind: 'text', text: '單一個 ` 反引號' }]);
  });

  it('行內 code 不跨行', () => {
    expect(parseInlineCode('a `b\nc` d')).toEqual([{ kind: 'text', text: 'a `b\nc` d' }]);
  });
});

describe('hasCodeBlock', () => {
  it('有 fence 回傳 true', () => {
    expect(hasCodeBlock('```c\nint x;\n```')).toBe(true);
  });

  it('沒有 fence 回傳 false', () => {
    expect(hasCodeBlock('變數 `x`')).toBe(false);
  });
});

describe('toPlainText', () => {
  it('去掉 fence 與行內反引號，供單行預覽使用', () => {
    expect(toPlainText('輸出為何？\n```c\nint x = 1;\nprintf("%d", x);\n```')).toBe(
      '輸出為何？ int x = 1; printf("%d", x);',
    );
  });

  it('行內 code 只去掉反引號', () => {
    expect(toPlainText('變數 `x` 的值')).toBe('變數 x 的值');
  });

  it('沒有 markdown 的文字原樣回傳', () => {
    expect(toPlainText('光合作用\n是什麼？')).toBe('光合作用\n是什麼？');
  });
});
