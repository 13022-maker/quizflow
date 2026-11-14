import { describe, expect, it } from 'vitest';

import { QuestionStreamParser } from './questionStreamParser';

const SAMPLE = JSON.stringify({
  title: '光合作用小測驗',
  questions: [
    { type: 'mc', question: '葉綠素{位於}哪裡？"引號" [括號]', options: ['(A)a', '(B)b', '(C)c', '(D)d'], answer: 'A', explanation: '說明\\n' },
    { type: 'rank', question: '排序', options: ['x', 'y'], answer: ['x', 'y'], explanation: '' },
    { type: 'mc', question: 'Q3', options: ['(A)1', '(B)2', '(C)3', '(D)4'], answer: 'B', explanation: '', diagram: { type: 'flow', steps: ['a', 'b'] } },
  ],
}, null, 2);

function feedInChunks(text: string, size: number) {
  const p = new QuestionStreamParser();
  let title: string | undefined;
  const qs: Record<string, unknown>[] = [];
  for (let i = 0; i < text.length; i += size) {
    const r = p.push(text.slice(i, i + size));
    if (r.title !== undefined) {
      title = r.title;
    }
    qs.push(...r.questions);
  }
  return { title, qs };
}

describe('QuestionStreamParser', () => {
  it.each([1, 3, 7, 64, 100000])('chunk 大小 %i 都能完整解析', (size) => {
    const { title, qs } = feedInChunks(SAMPLE, size);

    expect(title).toBe('光合作用小測驗');
    expect(qs).toEqual(JSON.parse(SAMPLE).questions);
  });

  it('題目在陣列閉合前就逐題吐出', () => {
    const p = new QuestionStreamParser();
    const cut = SAMPLE.indexOf('"type": "rank"');
    const first = p.push(SAMPLE.slice(0, cut));

    expect(first.title).toBe('光合作用小測驗');
    expect(first.questions).toHaveLength(1);

    const rest = p.push(SAMPLE.slice(cut));

    expect(rest.questions).toHaveLength(2);
    expect(rest.title).toBeUndefined();
  });

  it('忽略 ```json 圍欄與根物件前的雜訊', () => {
    const { title, qs } = feedInChunks(`\`\`\`json\n${SAMPLE}\n\`\`\``, 5);

    expect(title).toBe('光合作用小測驗');
    expect(qs).toHaveLength(3);
  });

  it('questions 排在 title 之前也能解析', () => {
    const text = JSON.stringify({ questions: [{ type: 'tf', question: 'q', answer: '○' }], title: 'T' });
    const { title, qs } = feedInChunks(text, 4);

    expect(title).toBe('T');
    expect(qs).toHaveLength(1);
  });

  it('被截斷的最後一題不會吐出，前面完整的題目照常保留', () => {
    const truncated = SAMPLE.slice(0, SAMPLE.lastIndexOf('"Q3"'));
    const { qs } = feedInChunks(truncated, 10);

    expect(qs).toHaveLength(2);
  });

  it('其他根層級陣列裡的物件不會被當成題目', () => {
    const text = JSON.stringify({ meta: [{ a: 1 }], title: 'T', questions: [{ type: 'mc', question: 'q' }] });
    const { qs } = feedInChunks(text, 6);

    expect(qs).toEqual([{ type: 'mc', question: 'q' }]);
  });
});
