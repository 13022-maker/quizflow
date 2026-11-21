import { describe, expect, it } from 'vitest';

import {
  buildPracticePageHtml,
  hasPracticePageAnalytics,
  injectPracticePageConfig,
  PRACTICE_PAGE_CONFIG_MARKER,
  selectPracticeQuestions,
} from './exportPracticePage';

describe('buildPracticePageHtml', () => {
  it('把題目資料內嵌進 <script>，畫面初始化用的到的欄位都在', () => {
    const html = buildPracticePageHtml({
      title: '單元測驗',
      kick: 'QuizFlow 測驗匯出',
      questions: [
        { groupLabel: '第一組', question: '1+1=?', options: ['1', '2', '3', '4'], correctIndex: 1 },
      ],
    });

    expect(html).toContain('<title>單元測驗 | QuizFlow</title>');
    expect(html).toContain('QuizFlow 測驗匯出');
    expect(html).toContain('"question":"1+1=?"');
    expect(html).toContain('"correctIndex":1');
    // 靜態頁的核心互動邏輯要原封不動保留
    expect(html).toContain('function selectOption');
    expect(html).toContain('addEventListener(\'keydown\'');
  });

  it('題目/選項內容裡若剛好出現 </script>，不能提前截斷 <script> 標籤', () => {
    const html = buildPracticePageHtml({
      title: '測試',
      kick: 'k',
      questions: [
        { groupLabel: 'g', question: '含</script>惡意內容的題目', options: ['a', 'b', 'c', 'd'], correctIndex: 0 },
      ],
    });

    // 內嵌 JSON 裡的 "<" 要被跳脫成 <，不會出現真正的 "</script>" 字樣把標籤斷開
    expect(html).not.toContain('</script>惡意');
    // 但頁面本身仍然只有一組合法的開頭/結尾 script 標籤
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });

  it('圖片選項物件({img,alt})會照原樣序列化進 QUESTIONS 資料', () => {
    const html = buildPracticePageHtml({
      title: '測試',
      kick: 'k',
      questions: [
        {
          groupLabel: 'g',
          question: '看圖選答案',
          options: [{ img: 'https://example.com/a.png', alt: '選項A' }, 'b', 'c', 'd'],
          correctIndex: 0,
        },
      ],
    });

    expect(html).toContain('"img":"https://example.com/a.png"');
  });

  it('沒有 explanation 欄位時，畫面邏輯要能正常運作（詳解區塊留空，不報錯）', () => {
    const html = buildPracticePageHtml({
      title: '測試',
      kick: 'k',
      questions: [
        { groupLabel: 'g', question: 'q', options: ['a', 'b', 'c', 'd'], correctIndex: 0 },
      ],
    });

    // QUESTIONS 資料裡不強制要求 explanation 這個 key
    expect(html).not.toContain('"explanation"');
    // render 邏輯要用 q.explanation ? ... : '' 的寫法防呆，不是直接假設一定有字串
    expect(html).toContain('q.explanation?');
  });

  it('題目若有 diagramSvg,會內嵌進 QUESTIONS 資料,且畫面渲染邏輯有處理這個欄位', () => {
    const html = buildPracticePageHtml({
      title: '測試',
      kick: 'k',
      questions: [
        {
          groupLabel: 'g',
          question: '流程圖題',
          diagramSvg: '<svg viewBox="0 0 100 50"><text x="10" y="20">A</text></svg>',
          options: ['a', 'b'],
          correctIndex: 0,
        },
      ],
    });

    // JSON 裡的 "<" 全部跳脫成 <(既有機制,見 toEmbeddableJson),
    // 所以檢查跳脫後的字樣,不是原始 "<svg>"
    expect(html).toContain('"diagramSvg":"\\u003csvg');
    // 渲染邏輯要處理這個新欄位
    expect(html).toContain('function diagramHtml');
  });
});

describe('selectPracticeQuestions', () => {
  it('單選題與是非題會被轉成 PracticePageQuestion，correctIndex 依 correctAnswers 比對 options', () => {
    const { practiceQuestions, skipped } = selectPracticeQuestions({
      groupLabel: '單元一',
      questions: [
        {
          type: 'single_choice',
          body: '1+1=?',
          options: [{ id: 'a', text: '1' }, { id: 'b', text: '2' }],
          correctAnswers: ['b'],
        },
        {
          type: 'true_false',
          body: '地球是圓的',
          options: null,
          correctAnswers: ['tf-true'],
        },
      ],
    });

    expect(skipped).toBe(0);
    expect(practiceQuestions).toHaveLength(2);
    expect(practiceQuestions[0]).toMatchObject({ groupLabel: '單元一', question: '1+1=?', correctIndex: 1 });
    // 是非題沒存 options 時要自動補上預設「正確/錯誤」選項（既有 bug fix 規則）
    expect(practiceQuestions[1]).toMatchObject({ options: ['正確', '錯誤'], correctIndex: 0 });
  });

  it('不支援的題型（如多選題）會被略過並計入 skipped', () => {
    const { practiceQuestions, skipped } = selectPracticeQuestions({
      groupLabel: '單元一',
      questions: [
        { type: 'multiple_choice', body: '多選題', options: [{ id: 'a', text: 'x' }], correctAnswers: ['a'] },
      ],
    });

    expect(practiceQuestions).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('support 的題型但缺 options 或 correctAnswers 比對不到時也視為略過', () => {
    const { practiceQuestions, skipped } = selectPracticeQuestions({
      groupLabel: '單元一',
      questions: [
        { type: 'single_choice', body: '壞題目', options: [{ id: 'a', text: 'x' }], correctAnswers: ['not-exist'] },
      ],
    });

    expect(practiceQuestions).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('圖片與詳解有值時會原樣帶進 PracticePageQuestion', () => {
    const { practiceQuestions } = selectPracticeQuestions({
      groupLabel: '單元一',
      questions: [
        {
          type: 'single_choice',
          body: '看圖回答',
          imageUrl: 'https://example.com/a.png',
          diagramSvg: '<svg></svg>',
          explanation: '因為...',
          options: [{ id: 'a', text: 'x' }],
          correctAnswers: ['a'],
        },
      ],
    });

    expect(practiceQuestions[0]?.image).toBe('<img src="https://example.com/a.png">');
    expect(practiceQuestions[0]?.diagramSvg).toBe('<svg></svg>');
    expect(practiceQuestions[0]?.explanation).toBe('因為...');
  });
});

describe('selectPracticeQuestions 題目 id', () => {
  it('DB 題目 id 會帶進 PracticePageQuestion，供作答事件對回題目', () => {
    const { practiceQuestions } = selectPracticeQuestions({
      groupLabel: 'g',
      questions: [{ id: 77, type: 'single_choice', body: 'q', options: [{ id: 'a', text: 'x' }], correctAnswers: ['a'] }],
    });

    expect(practiceQuestions[0]?.id).toBe(77);
  });
});

describe('練習頁作答統計 hooks', () => {
  const baseParams = {
    title: '測試',
    kick: 'k',
    questions: [{ groupLabel: 'g', question: 'q', options: ['a', 'b', 'c', 'd'], correctIndex: 0, id: 42 }],
  };

  it('題目 id 會內嵌進 QUESTIONS，讓事件能對回 DB 題目', () => {
    expect(buildPracticePageHtml(baseParams)).toContain('"id":42');
  });

  it('下載版本身不含任何 API 網址：沒有 config 時送出函式是 no-op（離線也能開）', () => {
    const html = buildPracticePageHtml(baseParams);

    expect(html).toContain(PRACTICE_PAGE_CONFIG_MARKER);
    expect(html).not.toContain('/api/p/');
    expect(html).toContain('window.__QF_PRACTICE__');
    // 送出前先檢查有沒有 endpoint
    expect(html).toContain('if(!CFG||!CFG.endpoint) return;');
  });

  it('作答結束畫面：分數、錯題跳轉、自我回報與 email 同意勾選都在', () => {
    const html = buildPracticePageHtml(baseParams);

    expect(html).toContain('function renderEnd');
    expect(html).toContain('我同意 QuizFlow 用此 email 寄送練習題與考試提醒，可隨時取消');
    expect(html).toContain('想收到下一份 20 題和考前提醒？留 email（選填）');
    // 不收姓名、學校、電話
    expect(html).not.toMatch(/name="(name|school|phone)"/);
  });

  it('輸入框打字時不能被數字鍵快捷鍵當成選選項', () => {
    expect(buildPracticePageHtml(baseParams)).toContain('isTypingTarget(e.target)');
  });
});

describe('injectPracticePageConfig', () => {
  it('把 config 以 <script> 塞到 marker 位置，內容裡的 "<" 會被跳脫', () => {
    const html = buildPracticePageHtml({
      title: 't',
      kick: 'k',
      questions: [{ groupLabel: 'g', question: 'q', options: ['a', 'b'], correctIndex: 0 }],
    });
    const out = injectPracticePageConfig(html, {
      endpoint: 'https://quizflow.example/api/p/24/events',
      signupUrl: 'https://quizflow.example/sign-up?x=</script>',
    });

    expect(out).toContain('<script>window.__QF_PRACTICE__={"endpoint":"https://quizflow.example/api/p/24/events"');
    expect(out).not.toContain('x=</script>');
    expect(out).not.toContain(PRACTICE_PAGE_CONFIG_MARKER);
  });

  it('舊版（沒有 marker）的 HTML 原樣回傳，不注入', () => {
    const legacy = '<html><head></head><body>old</body></html>';

    expect(injectPracticePageConfig(legacy, { endpoint: 'x', signupUrl: 'y' })).toBe(legacy);
    expect(hasPracticePageAnalytics(legacy)).toBe(false);
  });
});
