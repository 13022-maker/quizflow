import { describe, expect, it } from 'vitest';

import {
  extractCppSnippet,
  findAnswerKeyConflicts,
  findExplanationKeyConflict,
  matchOutputToOption,
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
