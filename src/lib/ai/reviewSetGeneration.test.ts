import { describe, expect, it } from 'vitest';

import { buildReviewSetPrompt, parseGeneratedReviewSet } from './reviewSetGeneration';

const VALID_SAMPLE = {
  content: '我覺得可以做一種不會污染空氣的車，這樣就不會塞車也不會空污了。',
  ref: { correctness: 2, completeness: 1, clarity: 2, creativity: 1 },
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
});
