import { describe, expect, it } from 'vitest';

import { computePageStartOffsets, matchImagesToQuestions, pageOfOffset } from './pdfImageMatch';

describe('computePageStartOffsets / pageOfOffset', () => {
  it('依每頁文字長度算出各頁起始位置，並能反查 offset 落在哪一頁', () => {
    const pageTexts = ['abc', 'de', 'fghij']; // 長度 3 / 2 / 5，joiner 預設 '\n'(長度1)
    const starts = computePageStartOffsets(pageTexts);

    // 第1頁 offset 0；第2頁 = 3+1=4；第3頁 = 4+2+1=7
    expect(starts).toEqual([0, 4, 7]);

    expect(pageOfOffset(0, starts)).toBe(1);
    expect(pageOfOffset(2, starts)).toBe(1);
    expect(pageOfOffset(4, starts)).toBe(2);
    expect(pageOfOffset(6, starts)).toBe(2);
    expect(pageOfOffset(7, starts)).toBe(3);
    expect(pageOfOffset(100, starts)).toBe(3); // 超出範圍歸最後一頁
  });
});

describe('matchImagesToQuestions', () => {
  it('同一頁剛好 1 題疑似需要圖、剛好 1 張圖 → 自動配對', () => {
    const questions = [{ question: '下圖所示為何？', sourceOffset: 0 }];
    const pageStartOffsets = [0];
    const imagesByPage = new Map([[1, ['img-A']]]);

    const { matched, unmatchedQuestions } = matchImagesToQuestions(questions, pageStartOffsets, imagesByPage);

    expect(matched.get(questions[0]!)).toBe('img-A');
    expect(unmatchedQuestions).toEqual([]);
  });

  it('同一頁有多題疑似需要圖但只有 1 張圖（數量不match）→ 不猜，全部歸類為待人工確認', () => {
    const q1 = { question: '下圖為何？', sourceOffset: 0 };
    const q2 = { question: '如圖所示，下列何者正確？', sourceOffset: 10 };
    const pageStartOffsets = [0];
    const imagesByPage = new Map([[1, ['img-A']]]); // 只有一張圖，卻有兩題疑似需要

    const { matched, unmatchedQuestions } = matchImagesToQuestions([q1, q2], pageStartOffsets, imagesByPage);

    expect(matched.size).toBe(0);
    expect(unmatchedQuestions).toEqual([q1, q2]);
  });

  it('一頁有一題需要圖但該頁完全沒有圖片 → 待人工確認，不報錯', () => {
    const q1 = { question: '下圖為何？', sourceOffset: 0 };
    const { matched, unmatchedQuestions } = matchImagesToQuestions([q1], [0], new Map());

    expect(matched.size).toBe(0);
    expect(unmatchedQuestions).toEqual([q1]);
  });

  it('題幹沒有「下圖/如圖」之類字眼的題目，即使該頁有圖也不會被誤配對', () => {
    const q1 = { question: '1+1等於多少？', sourceOffset: 0 };
    const imagesByPage = new Map([[1, ['img-A']]]);

    const { matched, unmatchedQuestions } = matchImagesToQuestions([q1], [0], imagesByPage);

    expect(matched.size).toBe(0);
    expect(unmatchedQuestions).toEqual([]); // 根本不覺得這題需要圖，不算「待確認」
  });

  it('跨頁：不同頁各自獨立配對，互不影響', () => {
    const q1 = { question: '下圖為何？', sourceOffset: 0 }; // 第1頁
    const q2 = { question: '如圖所示為何？', sourceOffset: 20 }; // 第2頁
    const pageStartOffsets = [0, 15];
    const imagesByPage = new Map([[1, ['img-page1']], [2, ['img-page2']]]);

    const { matched, unmatchedQuestions } = matchImagesToQuestions([q1, q2], pageStartOffsets, imagesByPage);

    expect(matched.get(q1)).toBe('img-page1');
    expect(matched.get(q2)).toBe('img-page2');
    expect(unmatchedQuestions).toEqual([]);
  });
});
