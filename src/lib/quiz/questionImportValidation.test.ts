import { describe, expect, it } from 'vitest';

import { validateImportQuestions } from './questionImportValidation';

describe('validateImportQuestions', () => {
  it('合法題目原樣保留（含額外欄位如 diagramSvg / imageUrl）', () => {
    const input = [
      { type: 'mc', question: '題目', options: ['(A)甲', '(B)乙'], answer: 'A', explanation: '說明', diagramSvg: '<svg/>' },
      { type: 'tf', question: '敘述', answer: '○' },
      { type: 'cloze', question: '植物利用[[葉綠素]]吸收光' },
      { type: 'rank', question: '排序', options: ['甲', '乙'], answer: ['甲', '乙'] },
      { type: 'listening', question: '聽力', options: ['甲', '乙'], answer: 'B', listeningText: '朗讀', audioUrl: 'https://x/a.mp3', audioDurationSec: 12 },
    ];

    const { questions, dropped } = validateImportQuestions(input);

    expect(dropped).toBe(0);
    expect(questions).toEqual(input);
  });

  it('選擇題答案對不到選項仍保留（維持既有行為：存成無正解讓老師補）', () => {
    const { questions, dropped } = validateImportQuestions([{ type: 'mc', question: '題目', options: ['甲', '乙'], answer: '丙' }]);

    expect(dropped).toBe(0);
    expect(questions).toHaveLength(1);
  });

  it('題幹空白 / 缺題幹 / 題幹非字串 → 丟棄', () => {
    const { questions, dropped } = validateImportQuestions([
      { type: 'mc', question: '  ', options: ['甲', '乙'], answer: 'A' },
      { type: 'tf', answer: '○' },
      { type: 'short', question: 123, answer: 'x' },
    ]);

    expect(questions).toEqual([]);
    expect(dropped).toBe(3);
  });

  it('未知題型 → 丟棄', () => {
    const { dropped } = validateImportQuestions([{ type: 'essay', question: '題目' }]);

    expect(dropped).toBe(1);
  });

  it('選項不是字串陣列、或含空白選項 → 丟棄', () => {
    const { questions, dropped } = validateImportQuestions([
      { type: 'mc', question: '題目', options: '甲,乙', answer: 'A' },
      { type: 'mc', question: '題目', options: ['甲', 2], answer: 'A' },
      { type: 'mc', question: '題目', options: ['甲', ' '], answer: 'A' },
    ]);

    expect(questions).toEqual([]);
    expect(dropped).toBe(3);
  });

  it('answer 型別錯誤（數字 / 物件）→ 丟棄', () => {
    const { dropped } = validateImportQuestions([
      { type: 'short', question: '題目', answer: 5 },
      { type: 'short', question: '題目', answer: { a: 1 } },
    ]);

    expect(dropped).toBe(2);
  });

  it('非物件元素 → 丟棄', () => {
    const { questions, dropped } = validateImportQuestions([null, 'x', 1, []]);

    expect(questions).toEqual([]);
    expect(dropped).toBe(4);
  });
});
