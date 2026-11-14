import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildFillBlankPracticePageHtml } from './exportFillBlankPracticePage';
import { buildPracticePageHtml, injectPracticePageConfig, type PracticePageRuntimeConfig } from './exportPracticePage';

// 回歸測試：學生按「確認送出」後 server 已收到成績（老師看得到），學生畫面卻像當掉、看不到結果與 Classroom 繳交按鈕。
// 兩種來源都要測：
//   1. 現在產生的新 HTML
//   2. __fixtures__ 裡 PR #90–#99 產生、已經寫進 Vercel Blob 的舊 HTML（經 /api/p/[id] 代理 injectPracticePageConfig 後）
// 型別宣告理由同 exportPracticePage.dom.test.ts（專案沒裝 @types/jsdom）。
type MinimalJsdom = {
  JSDOM: new (html: string, options: {
    url: string;
    runScripts: 'dangerously';
    beforeParse: (window: Window & typeof globalThis) => void;
  }) => { window: Window & typeof globalThis };
};
const { JSDOM } = createRequire(import.meta.url)('jsdom') as MinimalJsdom;

const FIXTURE_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '__fixtures__');
const LEGACY_MC_HTML = readFileSync(path.join(FIXTURE_DIR, 'legacy-practice-page-pr90-99.html'), 'utf8');
const LEGACY_FILLBLANK_HTML = readFileSync(path.join(FIXTURE_DIR, 'legacy-fillblank-practice-page-pr90-99.html'), 'utf8');

const CONFIG: PracticePageRuntimeConfig = {
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

const NEW_MC_HTML = buildPracticePageHtml({
  title: '光合作用',
  kick: 'k',
  questions: [
    { id: 1, groupLabel: 'g', question: 'Q1', options: ['a', 'b', 'c', 'd'], correctIndex: 1 },
    { id: 2, groupLabel: 'g', question: 'Q2', options: ['a', 'b', 'c', 'd'], correctIndex: 2 },
  ],
});
const NEW_FILLBLANK_HTML = buildFillBlankPracticePageHtml({
  title: '單字',
  kick: 'k',
  questions: [
    { groupLabel: 'g', before: '光合作用在', after: '進行', answer: '葉綠體' },
    { groupLabel: 'g', before: '水的化學式是', after: '', answer: 'H2O' },
  ],
});

type FetchMode = 'ok' | 'hang';

function load(pageHtml: string, mode: FetchMode = 'ok') {
  const scrollLog: string[] = [];
  const submitCalls: string[] = [];
  const dom = new JSDOM(pageHtml, {
    url: 'https://quizflow.example/api/p/24',
    runScripts: 'dangerously',
    beforeParse(window) {
      // jsdom 沒有版面，自己記錄捲動動作：scrollTo(頂端) 記成 'top'，scrollIntoView 記下目標元素
      window.scrollTo = () => {
        scrollLog.push('top');
      };
      window.Element.prototype.scrollIntoView = function (this: Element) {
        scrollLog.push(`into:${this.id || this.className}`);
      };
      (window.navigator as unknown as { sendBeacon: unknown }).sendBeacon = () => true;
      (window as unknown as { fetch: unknown }).fetch = (url: string) => {
        if (url !== CONFIG.submitEndpoint) {
          return Promise.resolve({ ok: true, status: 204, json: () => Promise.reject(new Error('no body')) });
        }
        submitCalls.push(url);
        if (mode === 'hang') {
          return new Promise(() => {}); // 連線卡住：永遠不 settle
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(SERVER_RESPONSE) });
      };
    },
  });
  return { doc: dom.window.document, scrollLog, submitCalls };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function serve(html: string, extra: Record<string, unknown> = {}) {
  return injectPracticePageConfig(html, { ...CONFIG, ...extra } as PracticePageRuntimeConfig);
}

function fillStudent(doc: Document) {
  (doc.getElementById('classInput') as HTMLInputElement).value = '301';
  (doc.getElementById('nameInput') as HTMLInputElement).value = '王小明';
  doc.getElementById('classInput')!.dispatchEvent(new doc.defaultView!.Event('input'));
}

function mcAnswerAll(doc: Document) {
  (doc.querySelectorAll('#qcard .opt')[1] as HTMLElement).click();
  (doc.getElementById('nextBtn') as HTMLElement).click();
  (doc.querySelectorAll('#qcard .opt')[0] as HTMLElement).click();
  (doc.getElementById('toEnd') as HTMLElement).click();
}

function fillBlankCheckAll(doc: Document) {
  (doc.getElementById('blankInput') as HTMLInputElement).value = '葉綠體';
  (doc.getElementById('checkBtn') as HTMLElement).click();
  (doc.getElementById('nextBtn') as HTMLElement).click();
  (doc.getElementById('blankInput') as HTMLInputElement).value = 'H2O';
  (doc.getElementById('checkBtn') as HTMLElement).click();
}

// Classroom 繳交按鈕必須存在、而且不在 hidden 容器裡
function visibleClassroomLink(doc: Document) {
  const links = Array.from(doc.querySelectorAll('a.classroom'));
  return links.find(a => !a.closest('[hidden]')) ?? null;
}

describe.each([
  ['新產生的 HTML', NEW_MC_HTML],
  ['PR #90–#99 寫進 Blob 的舊 HTML', LEGACY_MC_HTML],
])('選擇題練習頁（%s）', (_label, html) => {
  it('送出成功後：畫面會帶到成績與 Classroom 繳交按鈕，不會被捲回頂端', async () => {
    const { doc, scrollLog, submitCalls } = load(serve(html));
    mcAnswerAll(doc);
    fillStudent(doc);
    scrollLog.length = 0;

    (doc.getElementById('submitScoreBtn') as HTMLElement).click();
    await flush();
    await flush();

    expect(submitCalls).toHaveLength(1);
    expect(visibleClassroomLink(doc)).not.toBeNull();
    // 最後一個捲動動作必須是把結果區塊帶進畫面，而不是捲回頂端（手機上結果在畫面外 = 學生以為當掉）
    expect(scrollLog.at(-1)).toMatch(/^into:/);
    expect(scrollLog.at(-1)).not.toBe('top');
  });

  it('送出中離開結束畫面（點錯題回去看）：送出成功仍要顯示成績與 Classroom 按鈕', async () => {
    const { doc } = load(serve(html));
    mcAnswerAll(doc);
    fillStudent(doc);

    (doc.getElementById('submitScoreBtn') as HTMLElement).click();
    // fetch 回來前就點了錯題按鈕離開結束畫面
    (doc.querySelector('.wrongj') as HTMLElement).click();
    await flush();
    await flush();

    expect(visibleClassroomLink(doc)).not.toBeNull();
    expect(doc.body).toHaveTextContent(/已送出成績給老師/);
  });

  it('連線卡住不回應：逾時後顯示錯誤並可以再按一次，不會永遠停在「送出中…」', async () => {
    const { doc, submitCalls } = load(serve(html, { submitTimeoutMs: 30 }), 'hang');
    mcAnswerAll(doc);
    fillStudent(doc);

    (doc.getElementById('submitScoreBtn') as HTMLElement).click();
    await wait(80);

    expect(submitCalls).toHaveLength(1);
    expect(doc.getElementById('submitErr')?.textContent).toContain('逾時');
    expect((doc.getElementById('submitScoreBtn') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe.each([
  ['新產生的 HTML', NEW_FILLBLANK_HTML],
  ['PR #90–#99 寫進 Blob 的舊 HTML', LEGACY_FILLBLANK_HTML],
])('填空練習頁（%s）', (_label, html) => {
  it('送出成功：顯示結果視窗與 Classroom 繳交按鈕', async () => {
    const { doc } = load(serve(html));
    fillStudent(doc);
    fillBlankCheckAll(doc);
    (doc.getElementById('submitBtn') as HTMLElement).click();
    (doc.getElementById('confirmOkBtn') as HTMLElement).click();
    await flush();
    await flush();

    expect((doc.getElementById('resultOverlay') as HTMLElement).hidden).toBe(false);
    expect(visibleClassroomLink(doc)).not.toBeNull();
  });

  it('頁面自己的結果畫面渲染出錯：仍保證顯示成績與 Classroom 按鈕（備援面板），不會整個卡住', async () => {
    // 模擬結果視窗渲染途中丟例外（例如舊版頁面缺元素），原本例外被 promise 吞掉 → 畫面停住
    const broken = html.replace('<div id="submitStatus"></div>', '');
    const { doc } = load(serve(broken));
    fillStudent(doc);
    fillBlankCheckAll(doc);
    (doc.getElementById('submitBtn') as HTMLElement).click();
    (doc.getElementById('confirmOkBtn') as HTMLElement).click();
    await flush();
    await flush();

    const fallback = doc.getElementById('qfFallbackResult');

    expect(fallback).not.toBeNull();
    expect(fallback?.textContent).toContain('50 / 100');
    expect(visibleClassroomLink(doc)).not.toBeNull();
  });

  it('連線卡住不回應：逾時後在確認視窗顯示錯誤、按鈕恢復可再送', async () => {
    const { doc } = load(serve(html, { submitTimeoutMs: 30 }), 'hang');
    fillStudent(doc);
    fillBlankCheckAll(doc);
    (doc.getElementById('submitBtn') as HTMLElement).click();
    (doc.getElementById('confirmOkBtn') as HTMLElement).click();
    await wait(80);

    expect(doc.getElementById('confirmErr')?.textContent).toContain('逾時');
    expect((doc.getElementById('confirmOkBtn') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('/api/p/[id] 代理升級舊版送出程式', () => {
  it('舊 HTML 經代理後不再含沒有逾時的舊版 qfSubmit；離線（不經代理）的檔案原樣不動', () => {
    const legacySnippet = 'fetch(ep,{method:\'POST\',body:JSON.stringify(payload),credentials:\'omit\'';

    expect(LEGACY_MC_HTML).toContain(legacySnippet);
    expect(serve(LEGACY_MC_HTML)).not.toContain(legacySnippet);
    expect(serve(LEGACY_FILLBLANK_HTML)).not.toContain(legacySnippet);
    expect(serve(LEGACY_MC_HTML)).toContain('qfFallbackResult');
  });
});
