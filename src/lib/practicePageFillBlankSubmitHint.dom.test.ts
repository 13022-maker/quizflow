import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { buildFillBlankPracticePageHtml } from './exportFillBlankPracticePage';
import { injectPracticePageConfig } from './exportPracticePage';

// 從 PR #100 移植：填空練習頁條件不足時，「確認送出」按鈕原本是 disabled，學生按了完全沒反應。
// 改成按鈕可按、按下去說明還差什麼（沒核對的題數／沒填班級姓名）。
// 型別宣告理由同 exportPracticePage.dom.test.ts（專案沒裝 @types/jsdom）。
type MinimalJsdom = {
  JSDOM: new (html: string, options: {
    url: string;
    runScripts: 'dangerously';
    beforeParse: (window: Window & typeof globalThis) => void;
  }) => { window: Window & typeof globalThis };
};
const { JSDOM } = createRequire(import.meta.url)('jsdom') as MinimalJsdom;

const SUBMIT_URL = 'https://quizflow.example/api/p/24/submit';
const CONFIG = {
  endpoint: 'https://quizflow.example/api/p/24/events',
  signupUrl: 'https://quizflow.example/sign-up',
  submitEndpoint: SUBMIT_URL,
};

const SERVER_RESPONSE = {
  ok: true,
  score: 50,
  maxScore: 100,
  resultUrl: 'https://quizflow.example/api/p/24/r/tok_abc',
  classroomShareUrl: 'https://classroom.google.com/share?url=x&title=y',
};

type Mode = 'hang' | 'ok';

function load(pageHtml: string, mode: Mode, opts: { submitTimeoutMs?: number } = {}) {
  const submitCalls: string[] = [];
  const scrollTopCalls: unknown[] = [];
  const dom = new JSDOM(pageHtml, {
    url: 'https://quizflow.example/api/p/24',
    runScripts: 'dangerously',
    beforeParse(window) {
      window.scrollTo = ((arg: unknown) => {
        scrollTopCalls.push(arg);
      }) as typeof window.scrollTo;
      (window.navigator as unknown as { sendBeacon: unknown }).sendBeacon = () => true;
      if (opts.submitTimeoutMs) {
        // 代理注入的 config 之後才執行；這裡先掛一個 setter，讓注入的 config 帶上測試用逾時
        let cfg: Record<string, unknown> | undefined;
        Object.defineProperty(window, '__QF_PRACTICE__', {
          configurable: true,
          get: () => cfg,
          set: (v: Record<string, unknown>) => {
            cfg = { ...v, submitTimeoutMs: opts.submitTimeoutMs };
          },
        });
      }
      (window as unknown as { fetch: unknown }).fetch = (url: string) => {
        if (url !== SUBMIT_URL) {
          return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) });
        }
        submitCalls.push(url);
        if (mode === 'hang') {
          // 最壞情況：連線卡住、也不理會 AbortSignal，promise 永遠不 settle
          return new Promise(() => {});
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(SERVER_RESPONSE) });
      };
    },
  });
  return { doc: dom.window.document, win: dom.window, submitCalls, scrollTopCalls };
}

function setStudent(doc: Document, cls: string, name: string) {
  for (const [id, v] of [['classInput', cls], ['nameInput', name]] as const) {
    const input = doc.getElementById(id) as HTMLInputElement;
    input.value = v;
    input.dispatchEvent(new doc.defaultView!.Event('input'));
  }
}

const fbHtml = buildFillBlankPracticePageHtml({
  title: '單字',
  kick: 'k',
  questions: [
    { groupLabel: 'g', before: 'I eat an ', after: '.', answer: 'apple' },
    { groupLabel: 'g', before: '台灣最高峰是', after: '。', answer: '玉山' },
  ],
});

function fbCheck(doc: Document, i: number, typed: string) {
  (doc.querySelectorAll('.jbtn')[i] as HTMLElement).click();
  const input = doc.getElementById('blankInput') as HTMLInputElement;
  input.value = typed;
  input.dispatchEvent(new doc.defaultView!.Event('input'));
  (doc.getElementById('checkBtn') as HTMLElement).click();
}

describe('填空練習頁：條件不足時按「確認送出」要說明原因，不能沒反應', () => {
  it('沒填班級姓名：按鈕可以按，按下去顯示提示且不開確認視窗', () => {
    const { doc } = load(injectPracticePageConfig(fbHtml, CONFIG), 'ok');
    fbCheck(doc, 0, 'apple');
    fbCheck(doc, 1, '玉山');
    const btn = doc.getElementById('submitBtn') as HTMLButtonElement;

    expect(btn.disabled).toBe(false);

    btn.click();

    expect(doc.getElementById('submitHint')?.textContent).toContain('班級');
    expect((doc.getElementById('confirmOverlay') as HTMLElement).hidden).toBe(true);
  });

  it('還有題目沒核對：提示還剩幾題', () => {
    const { doc } = load(injectPracticePageConfig(fbHtml, CONFIG), 'ok');
    setStudent(doc, '301', '王小明');
    fbCheck(doc, 0, 'apple');
    (doc.getElementById('submitBtn') as HTMLElement).click();

    expect(doc.getElementById('submitHint')?.textContent).toContain('還有 1 題');
    expect((doc.getElementById('confirmOverlay') as HTMLElement).hidden).toBe(true);
  });
});
