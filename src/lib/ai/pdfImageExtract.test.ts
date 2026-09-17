import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { type PageImage, removeRepeatedDecorationImages } from './pdfImageExtract';

function img(pageNumber: number, content: string): PageImage {
  return { pageNumber, buffer: Buffer.from(content), contentType: 'image/png' };
}

describe('removeRepeatedDecorationImages', () => {
  it('濾掉跨頁重複出現（byte 完全相同）的裝飾圖片', () => {
    const images = [
      img(1, 'watermark'),
      img(1, 'question-1-diagram'),
      img(2, 'watermark'),
      img(2, 'question-9-diagram'),
      img(3, 'watermark'),
    ];

    const result = removeRepeatedDecorationImages(images);

    expect(result).toHaveLength(2);
    expect(result.map(i => i.buffer.toString())).toEqual([
      'question-1-diagram',
      'question-9-diagram',
    ]);
  });

  it('同一張圖只出現在單一頁時保留（不誤殺真正的題目附圖）', () => {
    const images = [img(1, 'diagram-a'), img(2, 'diagram-b')];

    const result = removeRepeatedDecorationImages(images);

    expect(result).toEqual(images);
  });

  it('空陣列輸入回傳空陣列', () => {
    expect(removeRepeatedDecorationImages([])).toEqual([]);
  });
});
