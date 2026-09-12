import { describe, expect, it } from 'vitest';

import { buildPracticePageHtml } from './exportPracticePage';

describe('buildPracticePageHtml', () => {
  it('把題目資料內嵌進 <script>，畫面初始化用的到的欄位都在', () => {
    const html = buildPracticePageHtml({
      title: '單元測驗',
      kick: 'QuizFlow 測驗匯出',
      noteHtml: '免登入、不計時',
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
      noteHtml: 'n',
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
      noteHtml: 'n',
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
      noteHtml: 'n',
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
      noteHtml: 'n',
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
