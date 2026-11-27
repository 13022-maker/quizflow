import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import {
  FILL_BLANK_NORMALIZE_CLIENT_JS,
  isFillBlankAnswerCorrect,
  normalizeFillBlankAnswer,
} from './answerNormalize';

// 練習頁內嵌 JS 版本：在測試裡真的執行字串，確認跟 TS 版行為一致
const clientNormalize = runInNewContext(
  `${FILL_BLANK_NORMALIZE_CLIENT_JS}\nqfNormalizeAnswer;`,
) as (s: string) => string;

// [學生輸入, 正確答案, 預期是否判對]，預期值皆為手算
const CASES: Array<[string, string, boolean]> = [
  ['n2', 'n²', true],
  ['n^2', 'n²', true],
  ['n**2', 'n²', true],
  ['ｎ２', 'n²', true], // 全形
  [' N2 ', 'n²', true],
  ['H2O', 'H₂O', true],
  ['h2o', 'H₂O', true],
  ['x^2 + 1', 'x²+1', true],
  ['n3', 'n²', false],
  ['', 'n²', false],
  ['   ', 'n²', false],
  ['n', 'n²', false],
  ['apple', 'Apple', true], // 既有行為：不分大小寫
  ['玉山', '玉山', true],
  ['cin', 'cout', false],
];

describe('normalizeFillBlankAnswer', () => {
  it('上標／下標轉一般字元', () => {
    expect(normalizeFillBlankAnswer('n²')).toBe('n2');
    expect(normalizeFillBlankAnswer('H₂O')).toBe('h2o');
    expect(normalizeFillBlankAnswer('xⁿ')).toBe('xn');
    expect(normalizeFillBlankAnswer('10⁻³')).toBe('10-3');
    expect(normalizeFillBlankAnswer('Ca²⁺')).toBe('ca2+');
  });

  it('移除次方記號 ^ 與 **', () => {
    expect(normalizeFillBlankAnswer('n^2')).toBe('n2');
    expect(normalizeFillBlankAnswer('n**2')).toBe('n2');
  });

  it('全形轉半形、去除所有空白、轉小寫', () => {
    expect(normalizeFillBlankAnswer('ｎ２')).toBe('n2');
    expect(normalizeFillBlankAnswer(' N 2 ')).toBe('n2');
    expect(normalizeFillBlankAnswer('\u3000N2\u3000')).toBe('n2'); // 全形空白
  });
});

describe('isFillBlankAnswerCorrect', () => {
  it.each(CASES)('學生輸入 %j、正確答案 %j → %s', (typed, answer, expected) => {
    expect(isFillBlankAnswerCorrect(typed, answer)).toBe(expected);
  });
});

describe('FILL_BLANK_NORMALIZE_CLIENT_JS（練習頁內嵌版）', () => {
  it.each(CASES)('與 TS 版一致：%j vs %j', (typed, answer) => {
    expect(clientNormalize(typed)).toBe(normalizeFillBlankAnswer(typed));
    expect(clientNormalize(answer)).toBe(normalizeFillBlankAnswer(answer));
  });

  it('字串不含反引號、反斜線、錢字號加大括號（會被塞進 TS template literal）', () => {
    expect(FILL_BLANK_NORMALIZE_CLIENT_JS).not.toMatch(/[`\\]|\$\{/);
  });
});
