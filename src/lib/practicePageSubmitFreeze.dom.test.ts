import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { buildFillBlankPracticePageHtml } from './exportFillBlankPracticePage';
import { buildPracticePageHtml, injectPracticePageConfig } from './exportPracticePage';

// 2026-11-10 老師回報：練習頁線上分享版按「確認送出」後畫面停滯、沒有任何回應。
// 這裡在 jsdom 真的執行練習頁內嵌 script，重現會讓學生「按了沒反應」的幾條路徑：
//   1. 送出請求卡住（教室網路不穩、App 內建瀏覽器）時 fetch 沒有逾時 → 永遠停在「送出中…」
//   2. 填空練習頁：還沒填班級姓名 / 還有題目沒核對時，按鈕是 disabled，按下去完全沒提示
//   3. 選擇題練習頁：按下送出後整頁捲回最上面，「送出中… / 已送出 / 錯誤訊息」都在畫面外
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

// 測試用把逾時縮短到 30ms（正式預設 15 秒），用真的計時器等它到期
const TEST_TIMEOUT_MS = 30;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

const mcHtml = buildPracticePageHtml({
  title: '光合作用',
  kick: 'k',
  questions: [
    { id: 1, groupLabel: 'g', question: 'Q1', options: ['a', 'b', 'c', 'd'], correctIndex: 1 },
    { id: 2, groupLabel: 'g', question: 'Q2', options: ['a', 'b', 'c', 'd'], correctIndex: 2 },
  ],
});

function mcAnswerAll(doc: Document) {
  (doc.querySelectorAll('#qcard .opt')[1] as HTMLElement).click();
  (doc.getElementById('nextBtn') as HTMLElement).click();
  (doc.querySelectorAll('#qcard .opt')[0] as HTMLElement).click();
  (doc.getElementById('toEnd') as HTMLElement).click();
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

describe('送出請求卡住：逾時後顯示錯誤並可重送（不再永遠停在「送出中…」）', () => {
  it('選擇題練習頁', async () => {
    const { doc, submitCalls } = load(injectPracticePageConfig(mcHtml, CONFIG), 'hang', { submitTimeoutMs: TEST_TIMEOUT_MS });
    mcAnswerAll(doc);
    setStudent(doc, '301', '王小明');
    (doc.getElementById('submitScoreBtn') as HTMLElement).click();

    expect(doc.getElementById('submitScoreBtn')?.textContent).toBe('送出中…');

    await wait(TEST_TIMEOUT_MS * 4);

    expect(submitCalls).toHaveLength(1);
    expect(doc.getElementById('submitErr')?.textContent).toContain('逾時');

    const btn = doc.getElementById('submitScoreBtn') as HTMLButtonElement;

    expect(btn.disabled).toBe(false);
    expect(btn).toHaveTextContent('✅ 確認送出');
  });

  it('填空練習頁', async () => {
    const { doc, submitCalls } = load(injectPracticePageConfig(fbHtml, CONFIG), 'hang', { submitTimeoutMs: TEST_TIMEOUT_MS });
    setStudent(doc, '301', '王小明');
    fbCheck(doc, 0, 'apple');
    fbCheck(doc, 1, '玉山');
    (doc.getElementById('submitBtn') as HTMLElement).click();
    (doc.getElementById('confirmOkBtn') as HTMLElement).click();

    expect(doc.getElementById('confirmOkBtn')?.textContent).toBe('送出中…');

    await wait(TEST_TIMEOUT_MS * 4);

    expect(submitCalls).toHaveLength(1);
    expect(doc.getElementById('confirmErr')?.textContent).toContain('逾時');

    const ok = doc.getElementById('confirmOkBtn') as HTMLButtonElement;

    expect(ok.disabled).toBe(false);
    expect(ok).toHaveTextContent('確定送出');
    expect((doc.getElementById('confirmCancelBtn') as HTMLButtonElement).disabled).toBe(false);
  });
});

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

describe('選擇題練習頁：按送出後不把畫面捲回頂端（送出狀態要留在學生眼前）', () => {
  it('送出中與送出成功的重繪都不呼叫 scrollTo(top)', async () => {
    const { doc, scrollTopCalls } = load(injectPracticePageConfig(mcHtml, CONFIG), 'ok');
    mcAnswerAll(doc);
    setStudent(doc, '301', '王小明');
    const before = scrollTopCalls.length;
    (doc.getElementById('submitScoreBtn') as HTMLElement).click();
    await wait(5);

    expect(doc.body).toHaveTextContent(/已送出成績給老師/);
    expect(scrollTopCalls.length).toBe(before);
  });
});

// PR #90 起每份分享連結的 HTML 都把這段 qfSubmit 原樣寫進 Vercel Blob（#90、#91、#97、#99 都相同）。
// 逐字抄自 main 250e4c7 src/lib/practicePageSubmitClient.ts，模擬已經發給學生的舊連結。
const LEGACY_QF_SUBMIT = `  function qfSubmit(payload,cb){
    var ep=qfSubmitEndpoint();
    if(!ep||!window.fetch){ cb('目前無法送出，請確認網路連線後再試'); return; }
    try{
      fetch(ep,{method:'POST',body:JSON.stringify(payload),credentials:'omit',headers:{'Content-Type':'text/plain;charset=UTF-8'}})
        .then(function(r){
          return r.json().catch(function(){ return null; }).then(function(d){ return {ok:r.ok,data:d}; });
        })
        .then(function(res){
          if(res.ok&&res.data&&res.data.ok){ cb(null,res.data); return; }
          var msg=(res.data&&typeof res.data.error==='string'&&res.data.error)?res.data.error:'送出失敗，請稍後再試';
          cb(msg);
        },function(){ cb('網路連線失敗，請檢查網路後再按一次送出'); });
    }catch(e){ cb('送出失敗，請稍後再試'); }
  }`;

function asLegacyBlob(html: string): string {
  const start = html.indexOf('  function qfSubmit(payload,cb){');
  const end = html.indexOf('  /* 送出成功後的 Classroom 分享按鈕');

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return `${html.slice(0, start)}${LEGACY_QF_SUBMIT}\n${html.slice(end)}`;
}

describe('舊連結（Blob 裡是舊版送出 JS）：/api/p/[id] 代理回傳時自動換成有逾時的新版', () => {
  it('舊版填空練習頁經代理注入後，卡住的送出也會逾時並顯示錯誤', async () => {
    const legacy = asLegacyBlob(fbHtml);

    expect(legacy).toContain(LEGACY_QF_SUBMIT);

    const served = injectPracticePageConfig(legacy, CONFIG);

    expect(served).not.toContain(LEGACY_QF_SUBMIT);

    const { doc } = load(served, 'hang', { submitTimeoutMs: TEST_TIMEOUT_MS });
    setStudent(doc, '301', '王小明');
    fbCheck(doc, 0, 'apple');
    fbCheck(doc, 1, '玉山');
    (doc.getElementById('submitBtn') as HTMLElement).click();
    (doc.getElementById('confirmOkBtn') as HTMLElement).click();
    await wait(TEST_TIMEOUT_MS * 4);

    expect(doc.getElementById('confirmErr')?.textContent).toContain('逾時');
    expect((doc.getElementById('confirmOkBtn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('舊版選擇題練習頁經代理注入後，卡住的送出也會逾時並顯示錯誤', async () => {
    const served = injectPracticePageConfig(asLegacyBlob(mcHtml), CONFIG);
    const { doc } = load(served, 'hang', { submitTimeoutMs: TEST_TIMEOUT_MS });
    mcAnswerAll(doc);
    setStudent(doc, '301', '王小明');
    (doc.getElementById('submitScoreBtn') as HTMLElement).click();
    await wait(TEST_TIMEOUT_MS * 4);

    expect(doc.getElementById('submitErr')?.textContent).toContain('逾時');
  });

  it('沒有舊版片段的 HTML（離線檔、加送出功能前的版本）不受影響', () => {
    const plain = '<html><head><!--qf-practice-config--></head><body>hi</body></html>';

    expect(injectPracticePageConfig(plain, CONFIG)).toBe(
      `<html><head><script>window.__QF_PRACTICE__=${JSON.stringify(CONFIG)};</script></head><body>hi</body></html>`,
    );
  });
});
