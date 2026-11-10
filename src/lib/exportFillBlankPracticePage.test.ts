import { describe, expect, it } from 'vitest';

import { buildFillBlankPracticePageHtml, selectFillBlankQuestions } from './exportFillBlankPracticePage';

describe('selectFillBlankQuestions', () => {
  it('多格題：題幹切成 N+1 段，正解依頓號拆成每格答案，answer 用「／」串起', () => {
    const { practiceQuestions, skipped } = selectFillBlankQuestions({
      groupLabel: 'g',
      questions: [
        { type: 'short_answer', body: '光合作用在___中進行，產生___。', correctAnswers: ['葉綠體、氧氣'] },
      ],
    });

    expect(skipped).toBe(0);
    expect(practiceQuestions[0]).toMatchObject({
      before: '光合作用在',
      after: '。',
      segments: ['光合作用在', '中進行，產生', '。'],
      answers: ['葉綠體', '氧氣'],
      answer: '葉綠體／氧氣',
    });
  });

  it('多格題但正解拆不出對應格數：略過（避免學生怎麼填都對不上）', () => {
    const { practiceQuestions, skipped } = selectFillBlankQuestions({
      groupLabel: 'g',
      questions: [
        { type: 'short_answer', body: '光合作用在___中進行，產生___。', correctAnswers: ['葉綠體'] },
      ],
    });

    expect(practiceQuestions).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('short_answer 題型且 body 含 ___ 標記時會被轉成填空題資料，空格前後文字正確切開', () => {
    const { practiceQuestions, skipped } = selectFillBlankQuestions({
      groupLabel: '第一組',
      questions: [
        { type: 'short_answer', body: '台灣最高峰是___。', correctAnswers: ['玉山'], explanation: '玉山海拔 3952 公尺' },
      ],
    });

    expect(skipped).toBe(0);
    expect(practiceQuestions).toHaveLength(1);
    expect(practiceQuestions[0]).toMatchObject({
      groupLabel: '第一組',
      before: '台灣最高峰是',
      after: '。',
      answer: '玉山',
      explanation: '玉山海拔 3952 公尺',
    });
  });

  it('不是 short_answer 題型（例如單選題）會被略過並計入 skipped', () => {
    const { practiceQuestions, skipped } = selectFillBlankQuestions({
      groupLabel: '第一組',
      questions: [
        { type: 'single_choice', body: '1+1=?', correctAnswers: ['2'] },
      ],
    });

    expect(practiceQuestions).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('short_answer 但 body 沒有 ___ 標記（純簡答題）會被略過', () => {
    const { practiceQuestions, skipped } = selectFillBlankQuestions({
      groupLabel: '第一組',
      questions: [
        { type: 'short_answer', body: '請簡述光合作用的過程', correctAnswers: ['略'] },
      ],
    });

    expect(practiceQuestions).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('沒有 correctAnswers 時也視為略過', () => {
    const { practiceQuestions, skipped } = selectFillBlankQuestions({
      groupLabel: '第一組',
      questions: [
        { type: 'short_answer', body: '台灣最高峰是___。', correctAnswers: null },
      ],
    });

    expect(practiceQuestions).toHaveLength(0);
    expect(skipped).toBe(1);
  });
});

describe('buildFillBlankPracticePageHtml', () => {
  const baseParams = {
    title: '填空練習',
    kick: 'QuizFlow 測驗匯出．填空練習頁',
    questions: [
      { groupLabel: '第一組', before: '台灣最高峰是', after: '。', answer: '玉山', explanation: '海拔 3952 公尺' },
    ],
  };

  it('把題目資料內嵌進 <script>，並包含填空題專用的互動邏輯', () => {
    const html = buildFillBlankPracticePageHtml(baseParams);

    expect(html).toContain('<title>填空練習 | QuizFlow</title>');
    expect(html).toContain('"answer":"玉山"');
    expect(html).toContain('"before":"台灣最高峰是"');
    // 空格必須是打字輸入，不能貼上
    expect(html).toContain('addEventListener(\'paste\'');
    // 看答案要扣分
    expect(html).toContain('hintUses');
    // 送出前要先確認
    expect(html).toContain('確認送出');
  });

  it('題目內容若剛好出現 </script>，不能提前截斷 <script> 標籤', () => {
    const html = buildFillBlankPracticePageHtml({
      ...baseParams,
      questions: [
        { groupLabel: 'g', before: '含</script>惡意內容的', after: '題目', answer: 'x' },
      ],
    });

    expect(html).not.toContain('</script>惡意');
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });

  it('預設看答案扣 3%，可透過 hintPenaltyPercent 參數調整', () => {
    const html = buildFillBlankPracticePageHtml({ ...baseParams, hintPenaltyPercent: 5 });

    expect(html).toContain('HINT_PENALTY_PERCENT=5');
  });
});
