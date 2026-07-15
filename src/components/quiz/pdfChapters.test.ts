import { describe, expect, it } from 'vitest';

import { buildChapters } from './pdfChapters';

describe('buildChapters', () => {
  it('依序 3 章：結束頁為下一章起始頁 −1，末章到尾頁', () => {
    const raw = [
      { title: '第1章 程式設計概論', start: 1 },
      { title: '第2章 迴圈結構', start: 8 },
      { title: '第3章 陣列', start: 15 },
    ];

    expect(buildChapters(raw, 25)).toEqual([
      { title: '第1章 程式設計概論', start: 1, end: 7 },
      { title: '第2章 迴圈結構', start: 8, end: 14 },
      { title: '第3章 陣列', start: 15, end: 25 },
    ]);
  });

  it('輸入未排序時會自動依起始頁排序', () => {
    const raw = [
      { title: '第2章', start: 8 },
      { title: '第1章', start: 1 },
    ];

    expect(buildChapters(raw, 10)).toEqual([
      { title: '第1章', start: 1, end: 7 },
      { title: '第2章', start: 8, end: 10 },
    ]);
  });

  it('空輸入回空陣列', () => {
    expect(buildChapters([], 10)).toEqual([]);
  });

  it('單一章節：結束頁為尾頁', () => {
    expect(buildChapters([{ title: '全冊', start: 1 }], 30)).toEqual([
      { title: '全冊', start: 1, end: 30 },
    ]);
  });

  it('重複起始頁時去重（保留第一個標題）', () => {
    const raw = [
      { title: '第1章', start: 1 },
      { title: '第1章重複書籤', start: 1 },
      { title: '第2章', start: 5 },
    ];

    expect(buildChapters(raw, 8)).toEqual([
      { title: '第1章', start: 1, end: 4 },
      { title: '第2章', start: 5, end: 8 },
    ]);
  });

  it('過濾無效項目（起始頁 < 1 或標題空白）', () => {
    const raw = [
      { title: '  ', start: 1 },
      { title: '第1章', start: 0 },
      { title: '第2章', start: 3 },
    ];

    expect(buildChapters(raw, 6)).toEqual([
      { title: '第2章', start: 3, end: 6 },
    ]);
  });
});
