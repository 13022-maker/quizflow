// 答案正規化工具：AI 回傳的各種答案寫法 → 系統標準正解
// 期望值一律手算 literal，不用被測函式自己推
import { describe, expect, it } from 'vitest';

import {
  matchChoiceAnswerId,
  normalizeFreeText,
  orderRankingOptions,
  parseTrueFalseAnswer,
  printOrderForRanking,
  resolveShortAnswerReference,
} from './answerNormalize';

const OPTS = [
  { id: 'a', text: '葉綠體' },
  { id: 'b', text: '粒線體' },
  { id: 'c', text: '細胞核' },
  { id: 'd', text: '液泡' },
];

describe('matchChoiceAnswerId', () => {
  it.each([
    ['C', 'c'],
    ['c', 'c'],
    ['(C)', 'c'],
    ['（C）', 'c'],
    ['C.', 'c'],
    ['C、', 'c'],
    ['Ｃ', 'c'],
    ['答案：C', 'c'],
    ['答案:(C)', 'c'],
    ['(C) 細胞核', 'c'],
    ['細胞核', 'c'],
    [' 細胞核 ', 'c'],
  ])('「%s」→ %s', (answer, expected) => {
    expect(matchChoiceAnswerId(OPTS, answer)).toBe(expected);
  });

  it('超出選項範圍的字母不亂對，回傳 null', () => {
    expect(matchChoiceAnswerId(OPTS, 'E')).toBeNull();
  });

  it('完全對不到時回傳 null（不默默退回 a）', () => {
    expect(matchChoiceAnswerId(OPTS, '高基氏體')).toBeNull();
    expect(matchChoiceAnswerId(OPTS, '')).toBeNull();
  });

  it('以英文字開頭的選項文字不會被誤判成字母', () => {
    const opts = [
      { id: 'a', text: 'Apple' },
      { id: 'b', text: 'Banana' },
    ];

    expect(matchChoiceAnswerId(opts, 'Banana')).toBe('b');
  });
});

describe('parseTrueFalseAnswer', () => {
  it.each(['○', '〇', 'O', 'o', 'Ｏ', '正確', '對', '是', 'true', 'TRUE', 'T', '✓', '✔', '√'])(
    '「%s」→ tf-true',
    (ans) => {
      expect(parseTrueFalseAnswer(ans)).toBe('tf-true');
    },
  );

  it.each(['✕', '✗', '×', 'X', 'x', 'Ｘ', '錯誤', '錯', '否', '非', 'false', 'F'])(
    '「%s」→ tf-false',
    (ans) => {
      expect(parseTrueFalseAnswer(ans)).toBe('tf-false');
    },
  );

  it('無法辨識時回傳 null（不默默當成「錯誤」）', () => {
    expect(parseTrueFalseAnswer('也許')).toBeNull();
    expect(parseTrueFalseAnswer('')).toBeNull();
  });
});

describe('orderRankingOptions', () => {
  it('options 依 correctAnswers 重排，讓「由上到下」= 正解', () => {
    const options = [
      { id: 'a', text: '工業革命' },
      { id: 'b', text: '文藝復興' },
      { id: 'c', text: '網際網路誕生' },
      { id: 'd', text: '二次大戰' },
    ];

    expect(orderRankingOptions(options, ['b', 'a', 'd', 'c'])).toEqual([
      { id: 'b', text: '文藝復興' },
      { id: 'a', text: '工業革命' },
      { id: 'd', text: '二次大戰' },
      { id: 'c', text: '網際網路誕生' },
    ]);
  });

  it('correctAnswers 不完整或含未知 id 時原樣返回，不弄丟選項', () => {
    const options = [
      { id: 'a', text: '甲' },
      { id: 'b', text: '乙' },
    ];

    expect(orderRankingOptions(options, ['b'])).toEqual(options);
    expect(orderRankingOptions(options, ['b', 'z'])).toEqual(options);
    expect(orderRankingOptions(options, undefined)).toEqual(options);
  });
});

describe('resolveShortAnswerReference', () => {
  it('有 referenceAnswer 就用它', () => {
    expect(resolveShortAnswerReference({ referenceAnswer: '評分要點', correctAnswers: ['氧氣'] })).toBe('評分要點');
  });

  it('沒有 referenceAnswer 時退回 correctAnswers[0]（AI 匯入的填充題）', () => {
    expect(resolveShortAnswerReference({ referenceAnswer: null, correctAnswers: ['氧氣'] })).toBe('氧氣');
    expect(resolveShortAnswerReference({ referenceAnswer: '', correctAnswers: ['氧氣'] })).toBe('氧氣');
  });

  it('兩者都沒有時回傳 null', () => {
    expect(resolveShortAnswerReference({ referenceAnswer: null, correctAnswers: null })).toBeNull();
  });
});

describe('normalizeFreeText', () => {
  it('全形英數轉半形、去頭尾空白、轉小寫', () => {
    expect(normalizeFreeText(' ＣＰＵ ')).toBe('cpu');
    expect(normalizeFreeText('２')).toBe('2');
  });
});

describe('printOrderForRanking', () => {
  const opts = [
    { id: 'a', text: '一' },
    { id: 'b', text: '二' },
    { id: 'c', text: '三' },
    { id: 'd', text: '四' },
  ];

  it('印出順序不等於正解順序（避免紙本洩題）', () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const printed = printOrderForRanking(opts, seed);

      expect(printed.map(o => o.id)).not.toEqual(['a', 'b', 'c', 'd']);
      expect([...printed.map(o => o.id)].sort()).toEqual(['a', 'b', 'c', 'd']);
    }
  });

  it('同一題（同 seed）每次印出順序相同，教師版與學生版才對得起來', () => {
    expect(printOrderForRanking(opts, 7)).toEqual(printOrderForRanking(opts, 7));
  });

  it('只有 0 或 1 個選項時原樣返回', () => {
    expect(printOrderForRanking([opts[0]!], 5)).toEqual([opts[0]]);
    expect(printOrderForRanking([], 5)).toEqual([]);
  });
});
