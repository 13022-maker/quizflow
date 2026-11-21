// 教師版答案文字：排序題用「→」表示順序，其他題型用「、」列出正解，不能混用
import { describe, expect, it } from 'vitest';

import { formatChoiceAnswer } from './quizExport';

const OPTS = [
  { id: 'a', text: '甲' },
  { id: 'b', text: '乙' },
  { id: 'c', text: '丙' },
];

describe('formatChoiceAnswer', () => {
  it('多選題兩個正解用「、」分隔並附字母，不出現「→」', () => {
    expect(formatChoiceAnswer(OPTS, ['a', 'c'])).toBe('(A) 甲、(C) 丙');
  });

  it('單選題只有一個正解', () => {
    expect(formatChoiceAnswer(OPTS, ['b'])).toBe('(B) 乙');
  });

  it('沒有正解時顯示「—」', () => {
    expect(formatChoiceAnswer(OPTS, null)).toBe('—');
    expect(formatChoiceAnswer(OPTS, [])).toBe('—');
  });
});
