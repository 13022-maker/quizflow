import { describe, expect, it } from 'vitest';

import { AI_ERA_FRAMEWORK_KEY, buildReviewSetPrompt, parseGeneratedReviewSet } from './reviewSetGeneration';

const VALID_SAMPLE = {
  content: '我覺得可以做一種不會污染空氣的車，這樣就不會塞車也不會空污了。',
  ref: { correctness: 2, completeness: 1, clarity: 2, creativity: 1 },
  isAiAnswer: false,
};

function validPayload() {
  return {
    topicPrompt: '請先幫每則範例答案打分數，接著小組討論設計一個全新的方案。',
    samples: [VALID_SAMPLE, VALID_SAMPLE, VALID_SAMPLE],
  };
}

describe('parseGeneratedReviewSet', () => {
  it('解析乾淨的 JSON 字串', () => {
    const raw = JSON.stringify(validPayload());

    expect(parseGeneratedReviewSet(raw)).toEqual(validPayload());
  });

  it('AI 回應前後夾雜文字時，仍能抽出中間的 JSON 物件', () => {
    const raw = `這是產生的結果：\n${JSON.stringify(validPayload())}\n以上。`;

    expect(parseGeneratedReviewSet(raw)).toEqual(validPayload());
  });

  it('非法 JSON 字串回傳 null', () => {
    expect(parseGeneratedReviewSet('這不是 JSON')).toBeNull();
  });

  it('samples 數量不是 3 則時回傳 null', () => {
    const payload = { ...validPayload(), samples: [VALID_SAMPLE, VALID_SAMPLE] };

    expect(parseGeneratedReviewSet(JSON.stringify(payload))).toBeNull();
  });

  it('rubric 分數超出 0-5 範圍時回傳 null', () => {
    const payload = validPayload();
    payload.samples = [
      { ...VALID_SAMPLE, ref: { ...VALID_SAMPLE.ref, correctness: 6 } },
      VALID_SAMPLE,
      VALID_SAMPLE,
    ];

    expect(parseGeneratedReviewSet(JSON.stringify(payload))).toBeNull();
  });

  it('缺少 topicPrompt 時回傳 null', () => {
    const payload: Record<string, unknown> = validPayload();
    delete payload.topicPrompt;

    expect(parseGeneratedReviewSet(JSON.stringify(payload))).toBeNull();
  });

  it('sample content 為空字串時回傳 null', () => {
    const payload = validPayload();
    payload.samples = [{ ...VALID_SAMPLE, content: '' }, VALID_SAMPLE, VALID_SAMPLE];

    expect(parseGeneratedReviewSet(JSON.stringify(payload))).toBeNull();
  });
});

describe('buildReviewSetPrompt', () => {
  it('把老師輸入的標題帶入 prompt', () => {
    const prompt = buildReviewSetPrompt('環保交通工具大挑戰');

    expect(prompt).toContain('環保交通工具大挑戰');
  });

  it('明確要求三則答案品質拉開差距（弱/中/強）', () => {
    const prompt = buildReviewSetPrompt('測試標題');

    expect(prompt).toMatch(/弱/);
    expect(prompt).toMatch(/中/);
    expect(prompt).toMatch(/強|完整|優秀/);
  });

  it('要求輸出合法 JSON 且不含 markdown', () => {
    const prompt = buildReviewSetPrompt('測試標題');

    expect(prompt).toContain('JSON');
  });

  it('要求故事情境用「但是/因此」因果鏈，禁止「然後」流水帳', () => {
    const prompt = buildReviewSetPrompt('測試標題');

    expect(prompt).toContain('但是');
    expect(prompt).toContain('因此');
    expect(prompt).toMatch(/不([要能可])[^。]*然後/);
  });

  it('限制故事情境閱讀字數，避免吃掉作答時間', () => {
    const prompt = buildReviewSetPrompt('測試標題');

    expect(prompt).toMatch(/150\s*字/);
  });

  it('要求以物觀物視角，避免敘事者說教式主觀評論', () => {
    const prompt = buildReviewSetPrompt('測試標題');

    expect(prompt).toContain('以物觀物');
  });
});

describe('buildReviewSetPrompt — framework 參數', () => {
  it('不傳 framework 時，輸出跟舊版完全一致（向後相容基準線）', () => {
    const withoutFramework = buildReviewSetPrompt('測試標題');
    const withUndefined = buildReviewSetPrompt('測試標題', undefined);

    expect(withUndefined).toBe(withoutFramework);
  });

  it('傳未知的 framework key 時，行為視同不指定（白名單防呆）', () => {
    const base = buildReviewSetPrompt('測試標題');
    const unknown = buildReviewSetPrompt('測試標題', 'not-a-real-framework');

    expect(unknown).toBe(base);
  });

  it('ai-era-thinking 框架會要求其中一則明確標示為 AI 生成解答', () => {
    const prompt = buildReviewSetPrompt('測試標題', AI_ERA_FRAMEWORK_KEY);

    expect(prompt).toContain('isAiAnswer');
    expect(prompt).toMatch(/AI\s*生成的?解答/);
  });

  it('ai-era-thinking 框架要求小組共創內容要超越/挑戰 AI 解答', () => {
    const prompt = buildReviewSetPrompt('測試標題', AI_ERA_FRAMEWORK_KEY);

    expect(prompt).toMatch(/超越|挑戰/);
  });

  it('ai-era-thinking 框架依 Polya 解題四步驟引導評斷（理解問題/擬定計畫/執行計畫/回顧與檢討）', () => {
    const prompt = buildReviewSetPrompt('測試標題', AI_ERA_FRAMEWORK_KEY);

    expect(prompt).toContain('理解問題');
    expect(prompt).toContain('擬定計畫');
    expect(prompt).toContain('執行計畫');
    expect(prompt).toContain('回顧與檢討');
  });

  it('ai-era-thinking 框架仍保留故事情境三原則（不互相打架）', () => {
    const prompt = buildReviewSetPrompt('測試標題', AI_ERA_FRAMEWORK_KEY);

    expect(prompt).toContain('但是');
    expect(prompt).toContain('因此');
    expect(prompt).toMatch(/150\s*字/);
    expect(prompt).toContain('以物觀物');
  });
});
