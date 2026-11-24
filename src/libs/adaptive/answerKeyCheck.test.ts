import { describe, expect, it } from 'vitest';

import {
  buildAssertionProgram,
  extractCppSnippet,
  findAnswerKeyConflicts,
  findCodeFormatProblems,
  findExplanationKeyConflict,
  matchOutputToOption,
  parseAssertionOutput,
  parseStateAssertion,
  repairInlineCodePrompt,
  wrapCppProgram,
} from './answerKeyCheck';

// 真實案例：item-for-loop-step-005，答案鍵標 9（index 2），解析結論與實際輸出都是 3
const forLoopItem = {
  id: 'item-for-loop-step-005',
  prompt: '下列程式片段執行後的輸出結果為何？\n```cpp\nint k = 0;\nfor (int j = 0; j < 6; j += 3) {\n    k += j;\n}\nprintf("%d", k);\n```',
  options: ['0', '3', '9', '18'],
  answerIndex: 2,
  explanation: 'j依序為0, 3。當j為6時，6<6不成立。k的變化為：初始k=0; j=0, k=0+0=0; j=3, k=0+3=3。當j為6時，迴圈不執行，所以最終k為3。',
};

describe('findExplanationKeyConflict', () => {
  it('解析結論是 3、答案鍵指向 9：回報衝突並指出解析結論的選項', () => {
    const conflict = findExplanationKeyConflict(forLoopItem);

    expect(conflict).not.toBeNull();
    expect(conflict?.explanationIndex).toBe(1);
    expect(conflict?.keyIndex).toBe(2);
  });

  it('解析結論與答案鍵一致：不回報', () => {
    expect(findExplanationKeyConflict({ ...forLoopItem, answerIndex: 1 })).toBeNull();
  });

  it('結論句後半提到常見錯誤選項（「而非 9」）：只看否定詞之前，不誤判', () => {
    const item = {
      ...forLoopItem,
      answerIndex: 1,
      explanation: 'j 只會是 0 和 3，所以答案是 3，而非 9（誤把 j=6 算進去）。',
    };

    expect(findExplanationKeyConflict(item)).toBeNull();
  });

  it('解析沒有結論詞：不判斷（避免誤殺）', () => {
    const item = { ...forLoopItem, explanation: '注意 j<6 的邊界條件，6 不會被執行到。' };

    expect(findExplanationKeyConflict(item)).toBeNull();
  });

  it('數字選項需整個 token 相符：「13」不算提到選項「3」', () => {
    const item = { ...forLoopItem, answerIndex: 2, explanation: '所以總和為 13。' };

    expect(findExplanationKeyConflict(item)).toBeNull();
  });

  it('結論同時提到兩個選項：無法判斷，不回報', () => {
    const item = { ...forLoopItem, answerIndex: 3, explanation: '所以 k 先變 0 再變 3。' };

    expect(findExplanationKeyConflict(item)).toBeNull();
  });

  it('沒有 explanation：不回報', () => {
    expect(findExplanationKeyConflict({ ...forLoopItem, explanation: undefined })).toBeNull();
  });
});

describe('findAnswerKeyConflicts', () => {
  it('回傳可回饋給模型的錯誤訊息（含題目 id 與兩個選項內容）', () => {
    const messages = findAnswerKeyConflicts([forLoopItem, { ...forLoopItem, id: 'ok', answerIndex: 1 }]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('item-for-loop-step-005');
    expect(messages[0]).toContain('「3」');
    expect(messages[0]).toContain('「9」');
  });
});

describe('extractCppSnippet', () => {
  it('從題幹的 ```cpp 圍欄取出程式碼', () => {
    expect(extractCppSnippet(forLoopItem.prompt)).toBe(
      'int k = 0;\nfor (int j = 0; j < 6; j += 3) {\n    k += j;\n}\nprintf("%d", k);',
    );
  });

  it('非 C/C++ 圍欄（python）：回傳 null', () => {
    expect(extractCppSnippet('輸出為何？\n```python\nprint(1)\n```')).toBeNull();
  });

  it('沒有程式碼圍欄：回傳 null', () => {
    expect(extractCppSnippet('int x = 5; 中 x 的型別是什麼？')).toBeNull();
  });
});

describe('wrapCppProgram', () => {
  it('片段沒有 main：包進 main 並補 include', () => {
    const program = wrapCppProgram('int k = 0;');

    expect(program).toContain('#include <bits/stdc++.h>');
    expect(program).toContain('int main()');
    expect(program).toContain('int k = 0;');
  });

  it('已有 main：補 include 但不再包一層', () => {
    const program = wrapCppProgram('int main() { return 0; }');

    expect(program.match(/int main\(/g)).toHaveLength(1);
  });
});

describe('matchOutputToOption', () => {
  it('stdout 完全等於某選項：回傳該索引', () => {
    expect(matchOutputToOption('3', ['0', '3', '9', '18'])).toBe(1);
  });

  it('忽略頭尾空白與多重空白：「1 2 3\\n」對到「1  2 3」', () => {
    expect(matchOutputToOption('1 2 3\n', ['1  2 3', '0 1 2'])).toBe(0);
  });

  it('對不到任何選項：回傳 -1', () => {
    expect(matchOutputToOption('7', ['0', '3', '9', '18'])).toBe(-1);
  });
});

// 真實案例：item-integrated-002，B（name[3]='y'）與 D（used[3]=5）都成立；
// 題幹把程式碼連行號擠成一行、沒有圍欄
const integratedItem = {
  id: 'item-integrated-002',
  prompt: '下列程式片段執行後的陣列內容，何者正確？ 1 int used[6] = {1, 2, 3, 4}, i; 2 char name[6] = "Alex"; 3 for(i = 1; i < 4; i++){ 4 used[i] = used[i] + 1; 5 name[i] = name[i] + 1; }',
  options: ['name[1]=\'B\'', 'name[3]=\'y\'', 'used[1]=2', 'used[3]=5'],
  answerIndex: 3,
  explanation: '所以used[3]=5是正確的。',
};

describe('extractCppSnippet：無圍欄、行號擠成一行的舊題', () => {
  it('去掉行號、每個陳述式換行，取出可編譯的程式碼', () => {
    const code = extractCppSnippet(integratedItem.prompt);

    expect(code).toContain('int used[6] = {1, 2, 3, 4}, i;');
    expect(code).toContain('char name[6] = "Alex";');
    expect(code).toContain('name[i] = name[i] + 1;');
    expect(code).not.toMatch(/(^|\n)\s*\d+\s+(int|char|for|used|name)/);
  });

  it('題幹沒有引用程式：不硬抽，回傳 null', () => {
    expect(extractCppSnippet('1 個位元組等於幾個位元？')).toBeNull();
  });
});

describe('parseStateAssertion', () => {
  it('「name[3]=\'y\'」解析成左值與期望值', () => {
    expect(parseStateAssertion('name[3]=\'y\'')).toEqual({ lhs: 'name[3]', rhs: '\'y\'' });
  });

  it('「used[3] == 5」也可以', () => {
    expect(parseStateAssertion('used[3] == 5')).toEqual({ lhs: 'used[3]', rhs: '5' });
  });

  it('字串常值（陣列不能用 == 比較）：不解析', () => {
    expect(parseStateAssertion('name="Bmfy"')).toBeNull();
  });

  it('不是「變數＝值」的選項：不解析', () => {
    expect(parseStateAssertion('3')).toBeNull();
    expect(parseStateAssertion('編譯錯誤')).toBeNull();
  });
});

describe('buildAssertionProgram / parseAssertionOutput', () => {
  it('在片段後面逐一印出每個選項是否成立', () => {
    const program = buildAssertionProgram('int a = 1;', [{ lhs: 'a', rhs: '1' }, { lhs: 'a', rhs: '2' }]);

    expect(program).toContain('((a) == (1))');
    expect(program).toContain('((a) == (2))');
    expect(program).toContain('__QF_ASSERT__');
  });

  it('解析輸出：只看標記之後的結果，忽略片段本身印的東西', () => {
    expect(parseAssertionOutput('hello\n__QF_ASSERT__\n0\n1\n1\n0\n')).toEqual([false, true, true, false]);
  });

  it('沒有標記（程式中途結束）：回傳 null', () => {
    expect(parseAssertionOutput('hello')).toBeNull();
  });
});

describe('findCodeFormatProblems', () => {
  it('題幹寫「下列程式」卻沒有程式碼圍欄：回報', () => {
    const messages = findCodeFormatProblems([integratedItem]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('item-integrated-002');
  });

  it('有圍欄：不回報', () => {
    expect(findCodeFormatProblems([forLoopItem])).toEqual([]);
  });
});

describe('repairInlineCodePrompt', () => {
  it('行號擠成一行的舊題：改寫成題目＋```cpp 圍欄', () => {
    const repaired = repairInlineCodePrompt(integratedItem.prompt);

    expect(repaired).toBe(
      '下列程式片段執行後的陣列內容，何者正確？\n```cpp\nint used[6] = {1, 2, 3, 4}, i;\nchar name[6] = "Alex";\nfor(i = 1; i < 4; i++){\n    used[i] = used[i] + 1;\n    name[i] = name[i] + 1;\n}\n```',
    );
  });

  it('已有圍欄：不改，回傳 null', () => {
    expect(repairInlineCodePrompt(forLoopItem.prompt)).toBeNull();
  });
});
