import { describe, expect, it } from 'vitest';

import {
  countBlanks,
  getMultiBlankCount,
  joinBlankAnswers,
  numberBlanks,
  resolveBlankAnswers,
  splitAnswerParts,
  splitBodyByBlanks,
} from './fillBlank';

describe('countBlanks', () => {
  it('計算 ___ 空格數（3 個以上底線算一格）', () => {
    expect(countBlanks('光合作用在___中進行，產生______。')).toBe(2);
  });

  it('全形底線與空白全形括號也算空格', () => {
    expect(countBlanks('首都是＿＿，人口約（　）萬')).toBe(2);
  });

  it('沒有空格、2 個底線（如 __init__）不算', () => {
    expect(countBlanks('請說明 __init__ 的用途')).toBe(0);
    expect(countBlanks('')).toBe(0);
    expect(countBlanks(null)).toBe(0);
  });

  it('``` 程式碼區塊裡的底線不算空格', () => {
    const body = '下列程式輸出為 ___\n```python\nx = \'____\'\n```\n第二格 ___';

    expect(countBlanks(body)).toBe(2);
  });
});

describe('getMultiBlankCount', () => {
  it('short_answer 且 2 格以上才回傳空格數', () => {
    expect(getMultiBlankCount({ type: 'short_answer', body: 'A___B___C' })).toBe(2);
  });

  it('單一空格 / 無空格 / 非 short_answer 一律回 0（維持原本 textarea）', () => {
    expect(getMultiBlankCount({ type: 'short_answer', body: '台灣最高峰是___。' })).toBe(0);
    expect(getMultiBlankCount({ type: 'short_answer', body: '請簡述光合作用' })).toBe(0);
    expect(getMultiBlankCount({ type: 'single_choice', body: 'A___B___C' })).toBe(0);
  });
});

describe('numberBlanks', () => {
  it('依序為每個空格加上編號', () => {
    expect(numberBlanks('光合作用在___中進行，產生______。')).toBe('光合作用在___(1)___中進行，產生___(2)___。');
  });

  it('程式碼區塊內不動', () => {
    expect(numberBlanks('答 ___\n```\na____b\n```\n再 ___')).toBe('答 ___(1)___\n```\na____b\n```\n再 ___(2)___');
  });
});

describe('splitBodyByBlanks', () => {
  it('切成 N+1 段文字', () => {
    expect(splitBodyByBlanks('光合作用在___中進行，產生___。')).toEqual(['光合作用在', '中進行，產生', '。']);
  });

  it('沒有空格回傳整段', () => {
    expect(splitBodyByBlanks('無空格')).toEqual(['無空格']);
  });
});

describe('joinBlankAnswers', () => {
  it('多格作答合併成帶編號的單一字串', () => {
    expect(joinBlankAnswers(['葉綠體', ' 氧氣 '])).toBe('(1) 葉綠體；(2) 氧氣');
  });

  it('部分空白標成（空白）', () => {
    expect(joinBlankAnswers(['葉綠體', ''])).toBe('(1) 葉綠體；(2) （空白）');
  });

  it('全部空白回傳空字串（交白卷）', () => {
    expect(joinBlankAnswers(['', '  '])).toBe('');
  });
});

describe('splitAnswerParts', () => {
  it('頓號分隔', () => {
    expect(splitAnswerParts('葉綠體、氧氣', 2)).toEqual(['葉綠體', '氧氣']);
  });

  it('逗號 / 分號 / 斜線 / 直線分隔', () => {
    expect(splitAnswerParts('goes, went', 2)).toEqual(['goes', 'went']);
    expect(splitAnswerParts('甲；乙；丙', 3)).toEqual(['甲', '乙', '丙']);
    expect(splitAnswerParts('甲 / 乙', 2)).toEqual(['甲', '乙']);
    expect(splitAnswerParts('a|b', 2)).toEqual(['a', 'b']);
  });

  it('編號格式 (1) 甲 (2) 乙、①甲②乙', () => {
    expect(splitAnswerParts('(1) 葉綠體 (2) 氧氣', 2)).toEqual(['葉綠體', '氧氣']);
    expect(splitAnswerParts('①葉綠體；②氧氣', 2)).toEqual(['葉綠體', '氧氣']);
  });

  it('優先用頓號，不會把含空白的答案拆錯', () => {
    expect(splitAnswerParts('New York、Tokyo', 2)).toEqual(['New York', 'Tokyo']);
  });

  it('拆不出剛好 N 份回傳 null', () => {
    expect(splitAnswerParts('葉綠體', 2)).toBeNull();
    expect(splitAnswerParts('', 2)).toBeNull();
  });

  it('n = 1 原樣回傳', () => {
    expect(splitAnswerParts(' 玉山 ', 1)).toEqual(['玉山']);
  });
});

describe('resolveBlankAnswers', () => {
  it('correctAnswers 筆數剛好等於空格數就直接用', () => {
    expect(resolveBlankAnswers(['甲', '乙'], 2)).toEqual(['甲', '乙']);
  });

  it('只有一筆時嘗試拆開', () => {
    expect(resolveBlankAnswers(['甲、乙'], 2)).toEqual(['甲', '乙']);
  });

  it('對不上回傳 null', () => {
    expect(resolveBlankAnswers(['甲'], 2)).toBeNull();
    expect(resolveBlankAnswers(['甲', '乙', '丙'], 2)).toBeNull();
    expect(resolveBlankAnswers(null, 2)).toBeNull();
  });
});
