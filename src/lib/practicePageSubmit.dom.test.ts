import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { buildFillBlankPracticePageHtml } from './exportFillBlankPracticePage';
import { buildPracticePageHtml, injectPracticePageConfig, PRACTICE_PAGE_CONFIG_MARKER } from './exportPracticePage';

// 在 jsdom 裡真的執行練習頁內嵌 script，驗證線上分享版的「確認送出 → 回傳成績 → 繳交到 Classroom」流程。
// 型別宣告理由同 exportPracticePage.dom.test.ts（專案沒裝 @types/jsdom）。
type MinimalJsdom = {
  JSDOM: new (html: string, options: {
    url: string;
    runScripts: 'dangerously';
    beforeParse: (window: Window & typeof globalThis) => void;
  }) => { window: Window & typeof globalThis };
};
const { JSDOM } = createRequire(import.meta.url)('jsdom') as MinimalJsdom;

const CONFIG = {
  endpoint: 'https://quizflow.example/api/p/24/events',
  signupUrl: 'https://quizflow.example/sign-up',
  submitEndpoint: 'https://quizflow.example/api/p/24/submit',
};

const SERVER_RESPONSE = {
  ok: true,
  score: 50,
  maxScore: 100,
  resultUrl: 'https://quizflow.example/api/p/24/r/tok_abc',
  classroomShareUrl: 'https://classroom.google.com/share?url=https%3A%2F%2Fquizflow.example%2Fapi%2Fp%2F24%2Fr%2Ftok_abc&title=x',
};

type FetchCall = { url: string; body: Record<string, unknown> };

function load(pageHtml: string, response: { status: number; data: unknown } = { status: 200, data: SERVER_RESPONSE }) {
  const fetchCalls: FetchCall[] = [];
  const dom = new JSDOM(pageHtml, {
    url: 'https://quizflow.example/api/p/24',
    runScripts: 'dangerously',
    beforeParse(window) {
      window.scrollTo = () => {};
      (window.navigator as unknown as { sendBeacon: unknown }).sendBeacon = () => true;
      (window as unknown as { fetch: unknown }).fetch = (url: string, init: { body: string }) => {
        if (url === CONFIG.submitEndpoint) {
          fetchCalls.push({ url, body: JSON.parse(init.body) });
        }
        return Promise.resolve({
          ok: response.status >= 200 && response.status < 300,
          status: response.status,
          json: () => Promise.resolve(response.data),
        });
      };
    },
  });
  return { doc: dom.window.document, fetchCalls };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('選擇題練習頁：線上送出', () => {
  const html = buildPracticePageHtml({
    title: '光合作用',
    kick: 'k',
    questions: [
      { id: 1, groupLabel: 'g', question: 'Q1', options: ['a', 'b', 'c', 'd'], correctIndex: 1 },
      { id: 2, groupLabel: 'g', question: 'Q2', options: ['a', 'b', 'c', 'd'], correctIndex: 2 },
    ],
  });

  function answerAll(doc: Document) {
    (doc.querySelectorAll('#qcard .opt')[1] as HTMLElement).click();
    (doc.getElementById('nextBtn') as HTMLElement).click();
    (doc.querySelectorAll('#qcard .opt')[0] as HTMLElement).click();
    (doc.getElementById('toEnd') as HTMLElement).click();
  }

  it('離線（下載檔）：不顯示班級姓名欄、結束畫面沒有送出按鈕（維持現狀）', () => {
    const { doc, fetchCalls } = load(html);

    expect((doc.getElementById('studentInfo') as HTMLElement).hidden).toBe(true);

    answerAll(doc);

    expect(doc.getElementById('submitScoreBtn')).toBeNull();
    expect(fetchCalls).toEqual([]);
  });

  it('線上：顯示班級姓名欄；沒填不能送；填了送出後顯示成績與 Classroom 按鈕', async () => {
    const { doc, fetchCalls } = load(injectPracticePageConfig(html, CONFIG));

    expect((doc.getElementById('studentInfo') as HTMLElement).hidden).toBe(false);

    answerAll(doc);
    (doc.getElementById('submitScoreBtn') as HTMLElement).click();

    expect(fetchCalls).toEqual([]);
    expect(doc.getElementById('submitErr')?.textContent).toContain('班級');

    (doc.getElementById('classInput') as HTMLInputElement).value = '301';
    (doc.getElementById('nameInput') as HTMLInputElement).value = '王小明';
    (doc.getElementById('submitScoreBtn') as HTMLElement).click();
    await flush();
    await flush();

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.body).toMatchObject({ className: '301', studentName: '王小明', answers: [1, 0] });
    expect(fetchCalls[0]!.body.sessionId).toMatch(/^[0-9a-f-]{36}$/);

    const link = doc.querySelector('a.classroom') as HTMLAnchorElement;

    expect(link).toHaveAttribute('href', SERVER_RESPONSE.classroomShareUrl);
    expect(doc.body).toHaveTextContent(/請選老師出的那份作業 → 按「繳交」/);
    expect(doc.getElementById('submitScoreBtn')).toBeNull();
    expect((doc.getElementById('nameInput') as HTMLInputElement).disabled).toBe(true);
  });

  it('server 回錯誤：顯示錯誤訊息、可以再按一次', async () => {
    const { doc, fetchCalls } = load(injectPracticePageConfig(html, CONFIG), { status: 409, data: { ok: false, error: '練習頁版本已更新' } });
    answerAll(doc);
    (doc.getElementById('classInput') as HTMLInputElement).value = '301';
    (doc.getElementById('nameInput') as HTMLInputElement).value = '王小明';
    (doc.getElementById('submitScoreBtn') as HTMLElement).click();
    await flush();
    await flush();

    expect(fetchCalls).toHaveLength(1);
    expect(doc.getElementById('submitErr')?.textContent).toContain('練習頁版本已更新');
    expect(doc.getElementById('submitScoreBtn')).not.toBeNull();
    expect(doc.querySelector('a.classroom')).toBeNull();
  });

  it('server 回傳非 Classroom 網址時不渲染按鈕（防 open redirect）', async () => {
    const { doc } = load(injectPracticePageConfig(html, CONFIG), {
      status: 200,
      data: { ...SERVER_RESPONSE, classroomShareUrl: 'https://evil.example/' },
    });
    answerAll(doc);
    (doc.getElementById('classInput') as HTMLInputElement).value = '301';
    (doc.getElementById('nameInput') as HTMLInputElement).value = '王小明';
    (doc.getElementById('submitScoreBtn') as HTMLElement).click();
    await flush();
    await flush();

    expect(doc.querySelector('a.classroom')).toBeNull();
  });
});

describe('填空練習頁：線上送出', () => {
  const html = buildFillBlankPracticePageHtml({
    title: '單字',
    kick: 'k',
    questions: [
      { groupLabel: 'g', before: 'I eat an ', after: '.', answer: 'apple' },
      { groupLabel: 'g', before: '台灣最高峰是', after: '。', answer: '玉山' },
    ],
  });

  function fillAndCheck(doc: Document, i: number, typed: string) {
    (doc.querySelectorAll('.jbtn')[i] as HTMLElement).click();
    const input = doc.getElementById('blankInput') as HTMLInputElement;
    input.value = typed;
    input.dispatchEvent(new doc.defaultView!.Event('input'));
    (doc.getElementById('checkBtn') as HTMLElement).click();
  }

  it('HTML 有 config 佔位註解，讓分享代理能注入送出端點', () => {
    expect(html).toContain(PRACTICE_PAGE_CONFIG_MARKER);
  });

  it('離線：維持本機算分，不呼叫任何 API', () => {
    const { doc, fetchCalls } = load(html);
    (doc.getElementById('classInput') as HTMLInputElement).value = '301';
    (doc.getElementById('nameInput') as HTMLInputElement).value = '王小明';
    fillAndCheck(doc, 0, 'apple');
    fillAndCheck(doc, 1, '錯');
    (doc.getElementById('submitBtn') as HTMLElement).click();
    (doc.getElementById('confirmOkBtn') as HTMLElement).click();

    expect(fetchCalls).toEqual([]);
    expect(doc.getElementById('finalScore')?.textContent).toBe('50');
    expect(doc.querySelector('a.classroom')).toBeNull();
  });

  it('線上：送出最後一次核對的內容與看答案次數，成功後顯示 server 分數與 Classroom 按鈕', async () => {
    const { doc, fetchCalls } = load(injectPracticePageConfig(html, CONFIG));
    (doc.getElementById('classInput') as HTMLInputElement).value = '301';
    (doc.getElementById('nameInput') as HTMLInputElement).value = '王小明';
    // 第 1 格：看一次答案再答對
    (doc.getElementById('hintBtn') as HTMLElement).click();
    fillAndCheck(doc, 0, 'Apple');
    // 第 2 格：核對錯的，之後改了但沒再核對 → 送出的應是核對過的內容
    fillAndCheck(doc, 1, '雪山');
    const input = doc.getElementById('blankInput') as HTMLInputElement;
    input.value = '玉山';
    input.dispatchEvent(new doc.defaultView!.Event('input'));

    (doc.getElementById('submitBtn') as HTMLElement).click();
    (doc.getElementById('confirmOkBtn') as HTMLElement).click();
    await flush();
    await flush();

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.body).toMatchObject({
      className: '301',
      studentName: '王小明',
      answers: [{ typed: 'Apple', hintUses: 1 }, { typed: '雪山', hintUses: 0 }],
    });
    expect(doc.getElementById('finalScore')?.textContent).toBe('50');
    expect(doc.querySelector('a.classroom')).toHaveAttribute('href', SERVER_RESPONSE.classroomShareUrl);
    expect(doc.body).toHaveTextContent(/請選老師出的那份作業 → 按「繳交」/);
    expect((doc.getElementById('classInput') as HTMLInputElement).disabled).toBe(true);
  });

  it('線上送出失敗：不鎖定，顯示錯誤，可以重送', async () => {
    const { doc, fetchCalls } = load(injectPracticePageConfig(html, CONFIG), { status: 500, data: { ok: false } });
    (doc.getElementById('classInput') as HTMLInputElement).value = '301';
    (doc.getElementById('nameInput') as HTMLInputElement).value = '王小明';
    fillAndCheck(doc, 0, 'apple');
    fillAndCheck(doc, 1, '玉山');
    (doc.getElementById('submitBtn') as HTMLElement).click();
    (doc.getElementById('confirmOkBtn') as HTMLElement).click();
    await flush();
    await flush();

    expect(fetchCalls).toHaveLength(1);
    expect(doc.getElementById('confirmErr')?.textContent).toContain('送出失敗');
    expect((doc.getElementById('classInput') as HTMLInputElement).disabled).toBe(false);
    expect((doc.getElementById('resultOverlay') as HTMLElement).hidden).toBe(true);
  });
});

describe('填空練習頁：多格題', () => {
  const html = buildFillBlankPracticePageHtml({
    title: '光合作用',
    kick: 'k',
    questions: [
      {
        groupLabel: 'g',
        before: '光合作用在',
        after: '。',
        segments: ['光合作用在', '中進行，產生', '。'],
        answers: ['葉綠體', '氧氣'],
        answer: '葉綠體／氧氣',
      },
    ],
  });

  function fill(doc: Document, id: string, typed: string) {
    const input = doc.getElementById(id) as HTMLInputElement;
    input.value = typed;
    input.dispatchEvent(new doc.defaultView!.Event('input'));
  }

  it('同一題渲染 2 個輸入框', () => {
    const { doc } = load(html);

    expect(doc.querySelectorAll('#qcard input.blank-input')).toHaveLength(2);
    expect(doc.getElementById('blankInput')).not.toBeNull();
    expect(doc.getElementById('blankInput1')).not.toBeNull();
  });

  it('兩格都對才算對；送出的 typed 用「／」串起各格，跟 answer key 同格式', async () => {
    const { doc, fetchCalls } = load(injectPracticePageConfig(html, CONFIG));
    (doc.getElementById('classInput') as HTMLInputElement).value = '301';
    (doc.getElementById('nameInput') as HTMLInputElement).value = '王小明';

    fill(doc, 'blankInput', '葉綠體');
    fill(doc, 'blankInput1', '二氧化碳');
    (doc.getElementById('checkBtn') as HTMLElement).click();

    expect(doc.getElementById('feedback')?.textContent).toContain('還不對');

    fill(doc, 'blankInput1', ' 氧氣 ');
    (doc.getElementById('checkBtn') as HTMLElement).click();

    expect(doc.getElementById('feedback')?.textContent).toContain('答對了');

    (doc.getElementById('submitBtn') as HTMLElement).click();
    (doc.getElementById('confirmOkBtn') as HTMLElement).click();
    await flush();
    await flush();

    expect(fetchCalls[0]!.body).toMatchObject({
      answers: [{ typed: '葉綠體／氧氣', hintUses: 0 }],
    });
  });
});
