import { describe, expect, it } from 'vitest';

import { type DemoQuestion, gradeDemoQuiz } from './demoQuiz';

// 手寫的小題組，期望值用人工推導的常數（不靠被測程式自己算）
const questions: DemoQuestion[] = [
  {
    id: 'q1',
    type: 'single_choice',
    body: '植物進行光合作用主要在哪個構造？',
    options: [{ id: 'a', text: '粒線體' }, { id: 'b', text: '葉綠體' }],
    correctAnswers: ['b'],
    explanation: '葉綠體含葉綠素。',
    tags: [],
  },
  {
    id: 'q2',
    type: 'true_false',
    body: '光合作用會釋放氧氣。',
    options: [{ id: 'tf-true', text: '正確' }, { id: 'tf-false', text: '錯誤' }],
    correctAnswers: ['tf-true'],
    explanation: '水分解後釋出氧氣。',
    tags: [],
  },
  {
    id: 'q3',
    type: 'multiple_choice',
    body: '下列哪些是光合作用的原料？（多選）',
    options: [{ id: 'a', text: '二氧化碳' }, { id: 'b', text: '水' }, { id: 'c', text: '葡萄糖' }],
    correctAnswers: ['a', 'b'],
    explanation: '葡萄糖是產物。',
    tags: [],
  },
];

describe('gradeDemoQuiz', () => {
  it('全對 → 3/3，100 分', () => {
    const result = gradeDemoQuiz(questions, { q1: ['b'], q2: ['tf-true'], q3: ['b', 'a'] });

    expect(result.correct).toBe(3);
    expect(result.total).toBe(3);
    expect(result.score).toBe(100);
    expect(result.results).toEqual({ q1: true, q2: true, q3: true });
  });

  it('多選題少選一個算錯（全對才給分）', () => {
    const result = gradeDemoQuiz(questions, { q1: ['b'], q2: ['tf-true'], q3: ['a'] });

    expect(result.results.q3).toBe(false);
    expect(result.correct).toBe(2);
    expect(result.score).toBe(67);
  });

  it('多選題多選一個也算錯', () => {
    const result = gradeDemoQuiz(questions, { q3: ['a', 'b', 'c'] });

    expect(result.results.q3).toBe(false);
  });

  it('沒作答的題目算錯，分數四捨五入到整數', () => {
    const result = gradeDemoQuiz(questions, { q1: ['b'] });

    expect(result.results).toEqual({ q1: true, q2: false, q3: false });
    expect(result.correct).toBe(1);
    expect(result.score).toBe(33);
  });
});
