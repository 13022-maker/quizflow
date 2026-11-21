import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { buildFillBlankPracticePageHtml } from './exportFillBlankPracticePage';

// 填空練習頁的題目附圖（例：public/practice/circuit-diagram-fill.html 的識圖題）。
// 型別宣告理由同 exportPracticePage.dom.test.ts（專案沒裝 @types/jsdom）。
type MinimalJsdom = {
  JSDOM: new (html: string, options: { url: string; runScripts: 'dangerously' }) => {
    window: Window & typeof globalThis;
  };
};
const { JSDOM } = createRequire(import.meta.url)('jsdom') as MinimalJsdom;

function render(questions: Parameters<typeof buildFillBlankPracticePageHtml>[0]['questions']) {
  const html = buildFillBlankPracticePageHtml({ title: 't', kick: 'k', questions });
  return new JSDOM(html, { url: 'https://quizflow.example/practice/x.html', runScripts: 'dangerously' }).window;
}

describe('填空練習頁：題目附圖', () => {
  it('有 image 時在題幹上方顯示圖片，src / alt 照填', () => {
    const win = render([
      { groupLabel: 'g', before: '下圖符號為', after: '。', answer: '電流源', image: 'images/q7.png', imageAlt: '第 7 題附圖' },
    ]);

    const img = win.document.querySelector('#qcard .qimg img') as HTMLImageElement | null;

    expect(img).not.toBeNull();
    expect(img!).toHaveAttribute('src', 'images/q7.png');
    expect(img!).toHaveAttribute('alt', '第 7 題附圖');
  });

  it('沒有 image 的題目不輸出圖片區塊（維持原本版面）', () => {
    const win = render([{ groupLabel: 'g', before: '台灣最高峰是', after: '。', answer: '玉山' }]);

    expect(win.document.querySelector('#qcard .qimg')).toBeNull();
  });

  it('image 路徑含引號時要 escape，不能跳出 src 屬性', () => {
    const win = render([
      { groupLabel: 'g', before: 'a', after: 'b', answer: 'x', image: 'x.png" onerror="alert(1)' },
    ]);

    const img = win.document.querySelector('#qcard .qimg img') as HTMLImageElement;

    expect(img).not.toHaveAttribute('onerror');
    expect(img).toHaveAttribute('src', 'x.png" onerror="alert(1)');
  });
});
