import { describe, expect, it } from 'vitest';

import {
  ensureCodeSnippets,
  hasCodeBlock,
  needsCodeSnippet,
  parseCodeBlocks,
  referencesCode,
  stripCodeFences,
} from './codeBlock';

describe('parseCodeBlocks', () => {
  it('沒有圍欄時回傳單一 text 段落', () => {
    expect(parseCodeBlocks('光合作用是一個過程。')).toEqual([
      { kind: 'text', text: '光合作用是一個過程。' },
    ]);
  });

  it('空字串回傳空陣列', () => {
    expect(parseCodeBlocks('')).toEqual([]);
  });

  it('解析題幹 + cpp 程式碼區塊，保留縮排與換行', () => {
    const body = '下列 C++ 程式的輸出為何？\n```cpp\nint main() {\n    int x = 3;\n    cout << x * 2;\n}\n```';

    expect(parseCodeBlocks(body)).toEqual([
      { kind: 'text', text: '下列 C++ 程式的輸出為何？' },
      { kind: 'code', lang: 'cpp', code: 'int main() {\n    int x = 3;\n    cout << x * 2;\n}' },
    ]);
  });

  it('程式碼區塊後面還有文字', () => {
    const body = '參考以下程式碼：\n```python\nprint(1 + 2)\n```\n請問輸出為何？';

    expect(parseCodeBlocks(body)).toEqual([
      { kind: 'text', text: '參考以下程式碼：' },
      { kind: 'code', lang: 'python', code: 'print(1 + 2)' },
      { kind: 'text', text: '請問輸出為何？' },
    ]);
  });

  it('沒標語言的圍欄 lang 為空字串', () => {
    expect(parseCodeBlocks('```\na = 1\n```')).toEqual([
      { kind: 'code', lang: '', code: 'a = 1' },
    ]);
  });

  it('圍欄緊貼在題幹文字後面（沒換行）也能解析', () => {
    expect(parseCodeBlocks('輸出為何？```cpp\ncout << 1;\n```')).toEqual([
      { kind: 'text', text: '輸出為何？' },
      { kind: 'code', lang: 'cpp', code: 'cout << 1;' },
    ]);
  });

  it('結尾圍欄緊貼在程式最後一行後面也能解析', () => {
    expect(parseCodeBlocks('```cpp\nint a = 1;\nreturn a;```\n後文')).toEqual([
      { kind: 'code', lang: 'cpp', code: 'int a = 1;\nreturn a;' },
      { kind: 'text', text: '後文' },
    ]);
  });

  it('未關閉的圍欄：剩下內容全部當程式碼（不吃掉內容）', () => {
    expect(parseCodeBlocks('題目\n```c\nint a;\nint b;')).toEqual([
      { kind: 'text', text: '題目' },
      { kind: 'code', lang: 'c', code: 'int a;\nint b;' },
    ]);
  });

  it('多個程式碼區塊', () => {
    const body = 'A：\n```cpp\nx++;\n```\nB：\n```cpp\n++x;\n```';

    expect(parseCodeBlocks(body)).toEqual([
      { kind: 'text', text: 'A：' },
      { kind: 'code', lang: 'cpp', code: 'x++;' },
      { kind: 'text', text: 'B：' },
      { kind: 'code', lang: 'cpp', code: '++x;' },
    ]);
  });

  it('CRLF 換行一律轉成 LF', () => {
    expect(parseCodeBlocks('題目\r\n```cpp\r\nint a;\r\n```')).toEqual([
      { kind: 'text', text: '題目' },
      { kind: 'code', lang: 'cpp', code: 'int a;' },
    ]);
  });

  it('程式碼內含 HTML 特殊字元原樣保留（escape 交給 React）', () => {
    expect(parseCodeBlocks('```cpp\n#include <iostream>\nif (a < b && c > d) {}\n```')).toEqual([
      { kind: 'code', lang: 'cpp', code: '#include <iostream>\nif (a < b && c > d) {}' },
    ]);
  });

  it('語言標記含 c++ / c# 等符號', () => {
    expect(parseCodeBlocks('```c++\nint a;\n```')[0]).toEqual({ kind: 'code', lang: 'c++', code: 'int a;' });
  });
});

describe('hasCodeBlock', () => {
  it('有圍欄 → true', () => {
    expect(hasCodeBlock('題目\n```cpp\nint a;\n```')).toBe(true);
  });

  it('沒有圍欄 → false', () => {
    expect(hasCodeBlock('下列程式的輸出為何？')).toBe(false);
  });

  it('只有空的圍欄 → false', () => {
    expect(hasCodeBlock('題目\n```cpp\n```')).toBe(false);
  });
});

describe('stripCodeFences', () => {
  it('去掉圍欄標記，保留程式碼內容', () => {
    expect(stripCodeFences('題目\n```cpp\nint a;\n```')).toBe('題目\nint a;');
  });

  it('沒有圍欄時原樣回傳', () => {
    expect(stripCodeFences('一般題目')).toBe('一般題目');
  });
});

describe('referencesCode', () => {
  it.each([
    '下列程式的輸出為何？',
    '下列 C++ 程式執行後，螢幕會印出什麼？',
    '以下程式碼執行結果為何？',
    '參考下面這段程式，變數 x 的值為何？',
    '請找出上述程式碼中的錯誤',
    '下列 Python 程式片段的輸出是？',
    '程式碼中 for 迴圈共執行幾次？',
    'What is the output of the following code?',
    'Refer to the code below.',
    'What does the following program print?',
  ])('偵測到引用程式碼：%s', (text) => {
    expect(referencesCode(text)).toBe(true);
  });

  it.each([
    '光合作用的產物為何？',
    '下列何者是 C++ 的關鍵字？',
    '程式設計中「變數」的意義為何？',
    '下列敘述何者正確？',
    '下列程式語言中，何者屬於直譯式語言？',
    '下列實驗程序何者正確？',
  ])('不是引用程式碼：%s', (text) => {
    expect(referencesCode(text)).toBe(false);
  });
});

describe('needsCodeSnippet', () => {
  it('提到下列程式但沒有附程式碼 → true（就是本次 bug）', () => {
    expect(needsCodeSnippet('下列 C++ 程式的輸出為何？')).toBe(true);
  });

  it('提到下列程式且有圍欄程式碼 → false', () => {
    expect(needsCodeSnippet('下列 C++ 程式的輸出為何？\n```cpp\ncout << 1;\n```')).toBe(false);
  });

  it('沒圍欄但題幹本身已經有多行程式碼 → false（不誤報）', () => {
    expect(needsCodeSnippet('下列程式的輸出為何？\nint x = 3;\ncout << x;')).toBe(false);
  });

  it('一般題目 → false', () => {
    expect(needsCodeSnippet('光合作用的產物為何？')).toBe(false);
  });
});

describe('ensureCodeSnippets', () => {
  it('AI 把程式碼放在獨立 code 欄位 → 併回 question 成為 cpp 圍欄，並刪掉 code 欄位', () => {
    const questions = [{
      type: 'mc',
      question: '下列程式的輸出為何？',
      code: '#include <iostream>\nint main() {\n    std::cout << 6;\n}',
    }];
    const result = ensureCodeSnippets(questions);

    expect(questions[0]).toEqual({
      type: 'mc',
      question: '下列程式的輸出為何？\n```cpp\n#include <iostream>\nint main() {\n    std::cout << 6;\n}\n```',
    });
    expect(result).toEqual({ repaired: 1, missing: [] });
  });

  it('code_snippet + language 欄位 → 用指定語言', () => {
    const questions = [{ question: '以下程式碼輸出為何？', code_snippet: 'print(3)', language: 'python' }];
    ensureCodeSnippets(questions);

    expect(questions[0]).toEqual({ question: '以下程式碼輸出為何？\n```python\nprint(3)\n```' });
  });

  it('已經有圍欄的題目不重複附加，但仍清掉多餘 code 欄位', () => {
    const questions = [{ question: '下列程式？\n```cpp\nint a;\n```', code: 'int a;' }];
    const result = ensureCodeSnippets(questions);

    expect(questions[0]).toEqual({ question: '下列程式？\n```cpp\nint a;\n```' });
    expect(result).toEqual({ repaired: 0, missing: [] });
  });

  it('提到程式卻完全沒程式碼 → 回報 missing 題號（0-based）', () => {
    const questions = [
      { question: '光合作用的產物為何？' },
      { question: '下列程式的輸出為何？' },
    ];

    expect(ensureCodeSnippets(questions)).toEqual({ repaired: 0, missing: [1] });
  });

  it('非陣列 / 缺 question 的元素不會 throw', () => {
    expect(ensureCodeSnippets(undefined)).toEqual({ repaired: 0, missing: [] });
    expect(ensureCodeSnippets([null, 3, { foo: 1 }])).toEqual({ repaired: 0, missing: [] });
  });

  it('支援自訂欄位名稱（bloom-studio 用 content）', () => {
    const questions = [{ content: '下列程式輸出？', code: 'x = 1' }];
    ensureCodeSnippets(questions, 'content');

    expect(questions[0]).toEqual({ content: '下列程式輸出？\n```\nx = 1\n```' });
  });
});
