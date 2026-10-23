import { describe, expect, it } from 'vitest';

import { partitionImportableQuestions, skippedQuestionsNotice } from './importableQuestions';

describe('partitionImportableQuestions', () => {
  it('完整題目全部保留，explanation 等欄位原封不動', () => {
    const q = { type: 'mc' as const, question: '1+1=?', options: ['1', '2'], answer: 'B', explanation: '因為 1+1=2' };

    expect(partitionImportableQuestions([q])).toEqual({ valid: [q], skipped: 0 });
  });

  it('題幹空白（含只有空白字元）視為不完整', () => {
    const result = partitionImportableQuestions([
      { type: 'short' as const, question: '   ', answer: 'x' },
      { type: 'short' as const, question: '', answer: 'x' },
      { type: 'short' as const, question: '說明光合作用', answer: 'x' },
    ]);

    expect(result.skipped).toBe(2);
    expect(result.valid.map(q => q.question)).toEqual(['說明光合作用']);
  });

  it('選擇題有空白選項視為不完整（存檔時 Zod 會擋「請輸入選項內容」）', () => {
    const result = partitionImportableQuestions([
      { type: 'mc' as const, question: 'Q', options: ['A', ''], answer: 'A' },
    ]);

    expect(result).toEqual({ valid: [], skipped: 1 });
  });

  it('question 不是字串（AI 回傳壞資料）視為不完整', () => {
    const result = partitionImportableQuestions([
      { type: 'tf' as const, question: undefined as unknown as string, answer: '○' },
    ]);

    expect(result.skipped).toBe(1);
  });
});

describe('skippedQuestionsNotice', () => {
  it('有略過：顯示題數', () => {
    expect(skippedQuestionsNotice(2)).toBe('2 題格式不完整已略過');
  });

  it('沒有略過：null', () => {
    expect(skippedQuestionsNotice(0)).toBeNull();
  });
});
