import { describe, expect, it } from 'vitest';

import {
  attachFigureLocators,
  computeCropRect,
  normalizeFigureBBox,
  parseFigureLocator,
} from './figureLocator';

describe('normalizeFigureBBox', () => {
  it('接受 0–1 比例的具名欄位 { left, top, right, bottom }', () => {
    expect(normalizeFigureBBox({ left: 0.1, top: 0.4, right: 0.55, bottom: 0.7 }))
      .toEqual({ left: 0.1, top: 0.4, right: 0.55, bottom: 0.7 });
  });

  it('接受陣列格式 [x0, y0, x1, y1]', () => {
    expect(normalizeFigureBBox([0.2, 0.3, 0.6, 0.5]))
      .toEqual({ left: 0.2, top: 0.3, right: 0.6, bottom: 0.5 });
  });

  it('數值大於 1（Gemini 常用的 0–1000 刻度）自動換算成 0–1', () => {
    expect(normalizeFigureBBox({ left: 100, top: 400, right: 550, bottom: 700 }))
      .toEqual({ left: 0.1, top: 0.4, right: 0.55, bottom: 0.7 });
  });

  it('左右、上下顛倒時自動對調', () => {
    expect(normalizeFigureBBox({ left: 0.6, top: 0.8, right: 0.2, bottom: 0.3 }))
      .toEqual({ left: 0.2, top: 0.3, right: 0.6, bottom: 0.8 });
  });

  it('稍微超出頁面邊界的值夾回 0–1', () => {
    expect(normalizeFigureBBox({ left: -0.05, top: 0.5, right: 1.02, bottom: 1 }))
      .toEqual({ left: 0, top: 0.5, right: 1, bottom: 1 });
  });

  it.each([
    ['null', null],
    ['字串', '0.1,0.2,0.3,0.4'],
    ['缺欄位', { left: 0.1, top: 0.2, right: 0.3 }],
    ['非數字', { left: 'a', top: 0.2, right: 0.3, bottom: 0.4 }],
    ['NaN', [Number.NaN, 0.2, 0.3, 0.4]],
    ['陣列長度不對', [0.1, 0.2, 0.3]],
    ['面積太小（寬度不到 2%）', { left: 0.5, top: 0.2, right: 0.51, bottom: 0.6 }],
    ['超過 1000 刻度', { left: 0, top: 0, right: 2000, bottom: 500 }],
    ['負的寬高（同一點）', { left: 0.3, top: 0.3, right: 0.3, bottom: 0.3 }],
  ])('不合法 → null：%s', (_label, raw) => {
    expect(normalizeFigureBBox(raw)).toBeNull();
  });
});

describe('parseFigureLocator', () => {
  it('合法 page + bbox', () => {
    expect(parseFigureLocator({ page: 2, bbox: { left: 0.1, top: 0.2, right: 0.5, bottom: 0.6 } }, 3))
      .toEqual({ page: 2, bbox: { left: 0.1, top: 0.2, right: 0.5, bottom: 0.6 } });
  });

  it('page 可以是數字字串', () => {
    expect(parseFigureLocator({ page: '1' }, 3)).toEqual({ page: 1, bbox: null });
  });

  it('bbox 缺漏或不合法 → 保留 page、bbox 為 null（之後退回整頁截圖，不丟圖）', () => {
    expect(parseFigureLocator({ page: 1 }, 1)).toEqual({ page: 1, bbox: null });
    expect(parseFigureLocator({ page: 1, bbox: 'oops' }, 1)).toEqual({ page: 1, bbox: null });
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['不是物件', 'page 1'],
    ['沒有 page', { bbox: [0.1, 0.1, 0.5, 0.5] }],
    ['page 為 0', { page: 0 }],
    ['page 超過頁數', { page: 4 }],
    ['page 非整數', { page: 1.5 }],
  ])('不合法 → null：%s', (_label, raw) => {
    expect(parseFigureLocator(raw, 3)).toBeNull();
  });
});

describe('attachFigureLocators', () => {
  it('把 AI 的頁碼（從送出檔案第 1 頁起算）加上 pageOffset 換成上傳檔案的頁碼，不合法的 figure 欄位刪除', () => {
    const questions: Array<Record<string, unknown>> = [
      { question: '如圖所示之電路，求 R', figure: { page: 1, bbox: [0.1, 0.4, 0.6, 0.7] } },
      { question: '一般題目' },
      { question: '如圖', figure: { page: 9 } },
      { question: '如圖', figure: 'xx' },
    ];

    const kept = attachFigureLocators(questions, { pageCount: 3, pageOffset: 4 });

    expect(kept).toBe(1);
    expect(questions[0]!.figure).toEqual({ page: 5, bbox: { left: 0.1, top: 0.4, right: 0.6, bottom: 0.7 } });
    expect('figure' in questions[1]!).toBe(false);
    expect('figure' in questions[2]!).toBe(false);
    expect('figure' in questions[3]!).toBe(false);
  });

  it('questions 不是陣列時不丟錯', () => {
    expect(attachFigureLocators(undefined, { pageCount: 1, pageOffset: 0 })).toBe(0);
  });
});

describe('computeCropRect', () => {
  it('依 bbox 換算像素並加上預設 2% 內距', () => {
    // 1000×2000 畫布，bbox 0.1–0.5 × 0.2–0.6 → 內距 x 20px、y 40px
    expect(computeCropRect({ left: 0.1, top: 0.2, right: 0.5, bottom: 0.6 }, 1000, 2000))
      .toEqual({ x: 80, y: 360, width: 440, height: 880 });
  });

  it('加內距後不超出畫布邊界', () => {
    expect(computeCropRect({ left: 0, top: 0.9, right: 1, bottom: 1 }, 1000, 1000))
      .toEqual({ x: 0, y: 880, width: 1000, height: 120 });
  });

  it('可自訂內距', () => {
    expect(computeCropRect({ left: 0.5, top: 0.5, right: 0.6, bottom: 0.6 }, 100, 100, 0))
      .toEqual({ x: 50, y: 50, width: 10, height: 10 });
  });

  it('bbox 為 null → 整頁', () => {
    expect(computeCropRect(null, 1190, 1684)).toEqual({ x: 0, y: 0, width: 1190, height: 1684 });
  });
});
