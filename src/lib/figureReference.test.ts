import { describe, expect, it } from 'vitest';

import { hasFigureReference, needsFigure } from './figureReference';

describe('hasFigureReference', () => {
  it('偵測到實際踩過的案例「如右圖所示之電路」', () => {
    expect(hasFigureReference('如右圖所示之電路，其中電流表 A 為理想的直流電流表，若讀值為 0.5A，則 R 值應為 ___ Ω。')).toBe(true);
  });

  it.each([
    '如圖所示，求電流 I',
    '如左圖，三個電阻串聯',
    '如上圖的電路',
    '如下圖所示',
    '下圖中的開關 S 閉合後',
    '參考上圖回答',
    '右圖為某電路',
    '請參考附圖',
    '圖一的電路中',
    '圖 2 中 R1 的電流為何',
    '圖3所示之波形',
    '如下表所示，求平均值',
    '依附表資料計算',
  ])('偵測到圖表參照：%s', (text) => {
    expect(hasFigureReference(text)).toBe(true);
  });

  it.each([
    '兩個 4 Ω 電阻並聯後的等效電阻為何？',
    '放學後我們一起上圖書館',
    '地圖一般以上方為北',
    '他試圖一次解完所有題目',
    '工程師畫藍圖 2 張',
    '企圖心',
    '',
  ])('不誤報：%s', (text) => {
    expect(hasFigureReference(text)).toBe(false);
  });
});

describe('needsFigure', () => {
  const body = '如右圖所示之電路，則 R 值應為 ___ Ω。';

  it('題目提到圖、卻沒有圖片也沒有圖解 → true', () => {
    expect(needsFigure({ body, imageUrl: null, diagramSvg: null })).toBe(true);
    expect(needsFigure({ body, imageUrl: '', diagramSvg: undefined })).toBe(true);
    expect(needsFigure({ body })).toBe(true);
  });

  it('已附圖片 → false', () => {
    expect(needsFigure({ body, imageUrl: 'https://example.com/circuit.png' })).toBe(false);
  });

  it('已有 AI 圖解 SVG → false', () => {
    expect(needsFigure({ body, diagramSvg: '<svg></svg>' })).toBe(false);
  });

  it('題目沒有提到圖 → false', () => {
    expect(needsFigure({ body: '兩個 4 Ω 電阻並聯後的等效電阻為何？' })).toBe(false);
  });
});
