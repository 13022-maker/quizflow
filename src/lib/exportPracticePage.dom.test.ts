import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { buildPracticePageHtml, injectPracticePageConfig } from './exportPracticePage';

// 真的在 jsdom 裡執行練習頁的內嵌 script，驗證作答統計與結束畫面的實際行為。
// jsdom 是 vitest 既有的測試依賴但專案沒裝 @types/jsdom，這裡只宣告用到的最小型別，不多裝套件。
type MinimalJsdom = {
  JSDOM: new (html: string, options: {
    url: string;
    referrer: string;
    runScripts: 'dangerously';
    beforeParse: (window: Window & typeof globalThis) => void;
  }) => { window: Window & typeof globalThis };
};
const { JSDOM } = createRequire(import.meta.url)('jsdom') as MinimalJsdom;

const html = buildPracticePageHtml({
  title: 'C++ 追蹤',
  kick: 'k',
  questions: [
    { id: 101, groupLabel: 'g', question: 'Q1', options: ['a', 'b', 'c', 'd'], correctIndex: 1 },
    { id: 102, groupLabel: 'g', question: 'Q2', options: ['a', 'b', 'c', 'd'], correctIndex: 2 },
  ],
});

function load(pageHtml: string) {
  const sent: Record<string, unknown>[] = [];
  const dom = new JSDOM(pageHtml, {
    url: 'https://quizflow.example/api/p/24?utm_source=shorts&utm_content=ep2',
    referrer: 'https://m.youtube.com/shorts/abc',
    runScripts: 'dangerously',
    beforeParse(window) {
      // jsdom 沒實作 scrollTo（會 console.error），測試環境補空函式
      window.scrollTo = () => {};
      // 用假的 Blob 把 sendBeacon 送出的內容記下來
      (window as unknown as { Blob: unknown }).Blob = class {
        parts: string[];
        constructor(parts: string[]) {
          this.parts = parts;
        }
      };
      (window.navigator as unknown as { sendBeacon: unknown }).sendBeacon = (_url: string, blob: { parts: string[] }) => {
        sent.push(JSON.parse(blob.parts.join('')));
        return true;
      };
    },
  });
  const doc = dom.window.document;
  const clickOption = (i: number) => (doc.querySelectorAll('#qcard .opt')[i] as HTMLElement).click();
  return { dom, doc, sent, clickOption };
}

describe('練習頁內嵌 script 行為', () => {
  it('離線（沒有 config）：照常作答、顯示結束畫面，但完全不送資料、也不顯示 email 欄位', () => {
    const { doc, sent, clickOption } = load(html);
    clickOption(0); // 第 1 題選錯
    (doc.getElementById('nextBtn') as HTMLElement).click();
    clickOption(2); // 第 2 題選對
    (doc.getElementById('toEnd') as HTMLElement).click();

    expect(sent).toEqual([]);
    expect(doc.querySelector('.score')?.textContent).toBe('1 / 2');
    expect([...doc.querySelectorAll('.wrongj')].map(b => b.textContent)).toEqual(['1']);
    expect(doc.getElementById('leadForm')).toBeNull();
  });

  it('線上（代理注入 config）：送出 session_start / answer / complete / profile / lead', () => {
    const online = injectPracticePageConfig(html, {
      endpoint: 'https://quizflow.example/api/p/24/events',
      signupUrl: 'https://quizflow.example/sign-up',
    });
    const { doc, sent, clickOption } = load(online);

    expect(sent[0]).toMatchObject({
      type: 'session_start',
      utmSource: 'shorts',
      utmContent: 'ep2',
      utmCampaign: null,
      referrerHost: 'm.youtube.com',
    });

    clickOption(1);
    (doc.getElementById('nextBtn') as HTMLElement).click();
    clickOption(0);

    expect(sent.slice(1).map(e => e.type)).toEqual(['answer', 'answer', 'complete']);
    expect(sent[1]).toMatchObject({ questionIndex: 0, questionId: 101, chosenOption: 1, isCorrect: true });
    expect(sent[2]).toMatchObject({ questionIndex: 1, questionId: 102, chosenOption: 0, isCorrect: false });
    expect(sent[3]).toMatchObject({ answeredCount: 2, correctCount: 1 });
    // 同一個 session
    expect(new Set(sent.map(e => e.sessionId)).size).toBe(1);

    // 已作答的題目再點不會重送
    clickOption(3);

    expect(sent).toHaveLength(4);

    (doc.getElementById('toEnd') as HTMLElement).click();

    // 選「老師」→ 送 profile、顯示邀請
    const teacherChip = doc.querySelector('.chips[data-g="role"] .chip[data-v="teacher"]') as HTMLElement;
    teacherChip.click();

    expect(sent[4]).toMatchObject({ type: 'profile', role: 'teacher', language: null, examPlan: null });
    expect((doc.getElementById('teacherInvite') as HTMLElement).hidden).toBe(false);

    // 沒勾同意不送 email
    (doc.getElementById('leadEmail') as HTMLInputElement).value = 'stu@example.com';
    const form = doc.getElementById('leadForm') as HTMLFormElement;
    form.dispatchEvent(new doc.defaultView!.Event('submit', { cancelable: true }));

    expect(sent).toHaveLength(5);
    expect(doc.getElementById('leadErr')?.textContent).toContain('勾選同意');

    (doc.getElementById('leadConsent') as HTMLInputElement).checked = true;
    form.dispatchEvent(new doc.defaultView!.Event('submit', { cancelable: true }));

    expect(sent[5]).toMatchObject({ type: 'lead', email: 'stu@example.com', consent: true });
    expect(doc.querySelector('.leadok')).not.toBeNull();
  });
});

describe('練習頁程式題顯示', () => {
  it('題目內 ``` 程式碼區塊顯示成等寬 <pre>，保留縮排、escape HTML、不顯示 ``` 符號', () => {
    const codeHtml = buildPracticePageHtml({
      title: 'C++',
      kick: 'k',
      questions: [{
        id: 1,
        groupLabel: 'g',
        question: '下列程式的輸出為何？\n```cpp\nint main() {\n    if (1 < 2) cout << "<b>";\n}\n```',
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 0,
      }],
    });
    const { doc } = load(codeHtml);
    const qbody = doc.querySelector('#qcard .qbody') as HTMLElement;
    const pre = qbody.querySelector('pre.qcode') as HTMLElement;

    expect(qbody.querySelector('.qtext')!).toHaveTextContent('下列程式的輸出為何？');
    // normalizeWhitespace: false → 驗證縮排與換行真的被保留
    expect(pre).toHaveTextContent('int main() {\n    if (1 < 2) cout << "<b>";\n}', { normalizeWhitespace: false });
    expect(pre.querySelector('b')).toBeNull();
    expect(qbody).not.toHaveTextContent(/```/);
  });

  it('一般題目維持單一 .qtext', () => {
    const { doc } = load(html);
    const qbody = doc.querySelector('#qcard .qbody') as HTMLElement;

    expect(qbody.querySelectorAll('.qtext')).toHaveLength(1);
    expect(qbody.querySelector('pre')).toBeNull();
  });
});
