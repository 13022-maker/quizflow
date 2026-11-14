import { describe, expect, it } from 'vitest';

import { type ComposerSourceQuestion, quizToComposerImport } from './examComposerMapper';

// 期望值皆為手推字面值，不用被測函式自己算
function q(partial: Partial<ComposerSourceQuestion>): ComposerSourceQuestion {
  return {
    type: 'single_choice',
    body: '題目',
    options: null,
    correctAnswers: null,
    referenceAnswer: null,
    points: 4,
    imageUrl: null,
    ...partial,
  };
}

describe('quizToComposerImport', () => {
  it('單選題：轉成 mc，選項剝除 (A) 前綴，正解轉成索引', () => {
    const r = quizToComposerImport('資料結構', [q({
      body: '下列何者是陣列？',
      options: [{ id: 'a', text: '(A)堆疊' }, { id: 'b', text: '陣列' }, { id: 'c', text: '佇列' }, { id: 'd', text: '鏈結串列' }],
      correctAnswers: ['b'],
    })]);

    expect(r.state.qs).toHaveLength(1);
    expect(r.state.qs[0]).toMatchObject({
      id: 'q1',
      type: 'mc',
      stem: '下列何者是陣列？',
      options: ['堆疊', '陣列', '佇列', '鏈結串列'],
      answer: 1,
      score: 4,
      unit: 'u1',
      bloom: '記憶',
    });
  });

  it('多選題：多個正解時 answer 為 null 並計入 multiToSingle', () => {
    const r = quizToComposerImport('T', [q({
      type: 'multiple_choice',
      options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }, { id: 'd', text: 'D' }],
      correctAnswers: ['a', 'c'],
    })]);

    expect(r.state.qs[0]!.type).toBe('mc');
    expect(r.state.qs[0]!.answer).toBeNull();
    expect(r.notes.multiToSingle).toBe(1);
  });

  it('是非題：tf-true → O、tf-false → X；無 options 也能判斷', () => {
    const r = quizToComposerImport('T', [
      q({ type: 'true_false', correctAnswers: ['tf-true'] }),
      q({ type: 'true_false', options: [{ id: 'x1', text: '正確' }, { id: 'x2', text: '錯誤' }], correctAnswers: ['x2'] }),
    ]);

    expect(r.state.qs.map(x => [x.type, x.answer])).toEqual([['tf', 'O'], ['tf', 'X']]);
  });

  it('簡答題：轉成 essay，優先用 referenceAnswer', () => {
    const r = quizToComposerImport('T', [q({ type: 'short_answer', referenceAnswer: '參考答案', correctAnswers: ['舊答案'], points: 10 })]);

    expect(r.state.qs[0]).toMatchObject({ type: 'essay', answer: '參考答案', score: 10 });
  });

  it('克漏字：轉成 fill，挖空變底線，答案以「；」串接', () => {
    const r = quizToComposerImport('T', [q({ type: 'cloze', body: '陣列索引從 [[0]] 開始，長度為 [[n]]。' })]);

    expect(r.state.qs[0]).toMatchObject({ type: 'fill', stem: '陣列索引從 ____ 開始，長度為 ____。', answer: '0；n' });
  });

  it('排序題略過並計數；有圖片的題目計入 withImage', () => {
    const r = quizToComposerImport('T', [
      q({ type: 'ranking' }),
      q({ imageUrl: 'https://x/y.png', options: [{ id: 'a', text: '1' }], correctAnswers: ['a'] }),
    ]);

    expect(r.state.qs).toHaveLength(1);
    expect(r.notes.skippedRanking).toBe(1);
    expect(r.notes.withImage).toBe(1);
  });

  it('state 結構：v=1、單一單元以測驗標題命名、nextQ 接續', () => {
    const r = quizToComposerImport('常見資料結構', [q({}), q({})]);

    expect(r.state).toMatchObject({
      v: 1,
      isSample: false,
      nextQ: 3,
      nextU: 2,
      units: [{ id: 'u1', name: '常見資料結構', periods: 1 }],
      threshold: 5,
    });
    expect(r.state.meta.exam).toBe('常見資料結構');
  });
});
