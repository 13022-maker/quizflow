import { describe, expect, it } from 'vitest';

import { parseGeneratedReviewSet } from '@/lib/ai/reviewSetGeneration';

import { calcModeSampleAccuracy } from './index';
import { judgmentHandler } from './judgment';
import type { ModeSample, ModeScoreRow } from './types';

const ZERO = { correctness: 0, completeness: 0, clarity: 0, creativity: 0 };
const OPTIONS = ['單位換算錯', '漏看條件', '計算錯誤', '概念誤解'];

function sampleOf(refData: unknown): ModeSample {
  return { id: 1, content: '範例答案', orderIndex: 0, ref: ZERO, refData };
}

function row(playerId: number, responseData: unknown): ModeScoreRow {
  return { playerId, sampleId: 1, rubric: ZERO, responseData };
}

const WRONG_REF = { isCorrect: false, reasonOptions: OPTIONS, correctReasonIndex: 0 };
const RIGHT_REF = { isCorrect: true, reasonOptions: OPTIONS, correctReasonIndex: null };

describe('judgment refSchema（老師標準答案）', () => {
  const schema = judgmentHandler.refSchema!;

  it('標準為「錯」＋合法錯因索引 → 通過，且選項會 trim', () => {
    const r = schema.safeParse({ isCorrect: false, reasonOptions: [' 單位換算錯 ', '漏看條件'], correctReasonIndex: 1 });

    expect(r.success).toBe(true);
    expect(r.success && r.data).toEqual({ isCorrect: false, reasonOptions: ['單位換算錯', '漏看條件'], correctReasonIndex: 1 });
  });

  it('標準為「對」也必須有 2–4 個誘答錯因（防止「沒選項＝這則是對的」洩題），且 correctReasonIndex 必須 null', () => {
    expect(schema.safeParse(RIGHT_REF).success).toBe(true);
    expect(schema.safeParse({ isCorrect: true, reasonOptions: [], correctReasonIndex: null }).success).toBe(false);
    expect(schema.safeParse({ isCorrect: true, reasonOptions: OPTIONS, correctReasonIndex: 0 }).success).toBe(false);
  });

  it('選項數量必須 2–4 個', () => {
    expect(schema.safeParse({ isCorrect: false, reasonOptions: ['只有一個'], correctReasonIndex: 0 }).success).toBe(false);
    expect(schema.safeParse({ isCorrect: false, reasonOptions: [...OPTIONS, '第五個'], correctReasonIndex: 0 }).success).toBe(false);
  });

  it('選項 trim 後不可空白、不可超過 40 字、不可重複', () => {
    expect(schema.safeParse({ isCorrect: false, reasonOptions: ['  ', '漏看條件'], correctReasonIndex: 1 }).success).toBe(false);
    expect(schema.safeParse({ isCorrect: false, reasonOptions: ['字'.repeat(41), '漏看條件'], correctReasonIndex: 1 }).success).toBe(false);
    expect(schema.safeParse({ isCorrect: false, reasonOptions: ['字'.repeat(40), '漏看條件'], correctReasonIndex: 1 }).success).toBe(true);
    expect(schema.safeParse({ isCorrect: false, reasonOptions: ['計算錯誤', ' 計算錯誤'], correctReasonIndex: 0 }).success).toBe(false);
  });

  it('老師還沒設定（undefined）→ 擋下並回繁中訊息', () => {
    const r = schema.safeParse(undefined);

    expect(r.success ? '' : r.error.errors[0]?.message).toBe('請設定這則答案的對錯與錯因選項');
  });

  it('標準為「錯」時 correctReasonIndex 必須是合法索引，錯誤訊息為繁中', () => {
    const missing = schema.safeParse({ isCorrect: false, reasonOptions: OPTIONS, correctReasonIndex: null });
    const outOfRange = schema.safeParse({ isCorrect: false, reasonOptions: ['a', 'b'], correctReasonIndex: 2 });

    expect(missing.success).toBe(false);
    expect(missing.success ? '' : missing.error.errors[0]?.message).toBe('請選定正確的錯因');
    expect(outOfRange.success).toBe(false);
  });
});

describe('judgment responseSchema（學生作答）', () => {
  const schema = judgmentHandler.responseSchema!;

  it('判對時 reasonIndex 必須 null；判錯時必須選錯因', () => {
    expect(schema.safeParse({ isCorrect: true, reasonIndex: null }).success).toBe(true);
    expect(schema.safeParse({ isCorrect: true, reasonIndex: 0 }).success).toBe(false);
    expect(schema.safeParse({ isCorrect: false, reasonIndex: 2 }).success).toBe(true);
    expect(schema.safeParse({ isCorrect: false, reasonIndex: null }).success).toBe(false);
  });

  it('reasonIndex 只能是 0–3 的整數', () => {
    expect(schema.safeParse({ isCorrect: false, reasonIndex: 4 }).success).toBe(false);
    expect(schema.safeParse({ isCorrect: false, reasonIndex: -1 }).success).toBe(false);
    expect(schema.safeParse({ isCorrect: false, reasonIndex: 1.5 }).success).toBe(false);
  });
});

describe('judgment validateSet / toClientData', () => {
  it('整組至少要有 1 則是錯的', () => {
    expect(judgmentHandler.validateSet([{ content: 'a', refData: RIGHT_REF }, { content: 'b', refData: RIGHT_REF }]))
      .toBe('至少要有 1 則範例答案標為「有錯」，全對的題組沒有批閱價值');
    expect(judgmentHandler.validateSet([{ content: 'a', refData: RIGHT_REF }, { content: 'b', refData: WRONG_REF }])).toBeNull();
  });

  it('學生端只拿到錯因選項，不含 isCorrect / correctReasonIndex；對、錯兩種的形狀完全一樣', () => {
    const wrong = judgmentHandler.toClientData({ content: 'x', refData: WRONG_REF });
    const right = judgmentHandler.toClientData({ content: 'x', refData: RIGHT_REF });

    expect(wrong).toEqual({ reasonOptions: OPTIONS });
    expect(right).toEqual({ reasonOptions: OPTIONS });
  });
});

describe('judgment 計分', () => {
  it('標準為「錯」、配分 200：判錯+錯因對(100%)、判錯+錯因錯(50%)、判對(0%)、判錯+錯因對(100%) → 平均 62.5% → 125', () => {
    // (1 + 0.5 + 0 + 1) / 4 = 0.625；0.625 × 200 = 125
    const scores = [
      row(1, { isCorrect: false, reasonIndex: 0 }),
      row(2, { isCorrect: false, reasonIndex: 2 }),
      row(3, { isCorrect: true, reasonIndex: null }),
      row(4, { isCorrect: false, reasonIndex: 0 }),
    ];

    expect(calcModeSampleAccuracy('judgment', { sample: sampleOf(WRONG_REF), sampleScores: scores, sampleCount: 3, pointsForSample: 200 })).toBe(125);
  });

  it('標準為「對」、配分 250：判對、判對、判錯 → 2/3 → 166.67 四捨五入 167', () => {
    // (1 + 1 + 0) / 3 × 250 = 166.666… → 167
    const scores = [
      row(1, { isCorrect: true, reasonIndex: null }),
      row(2, { isCorrect: true, reasonIndex: null }),
      row(3, { isCorrect: false, reasonIndex: 1 }),
    ];

    expect(calcModeSampleAccuracy('judgment', { sample: sampleOf(RIGHT_REF), sampleScores: scores, sampleCount: 3, pointsForSample: 250 })).toBe(167);
  });

  it('標準為「錯」、配分 333：只有一人判錯但錯因選錯 → 50% → 166.5 四捨五入 167', () => {
    // 0.5 × 333 = 166.5 → Math.round → 167
    const scores = [row(1, { isCorrect: false, reasonIndex: 3 })];

    expect(judgmentHandler.calcSampleAccuracy({ sample: sampleOf(WRONG_REF), sampleScores: scores, sampleCount: 3, pointsForSample: 333 })).toBe(167);
  });

  it('作答資料損毀的列視為 0%，不會讓計分爆掉', () => {
    // (1 + 0) / 2 × 100 = 50
    const scores = [row(1, { isCorrect: false, reasonIndex: 0 }), row(2, { foo: 'bar' })];

    expect(judgmentHandler.calcSampleAccuracy({ sample: sampleOf(WRONG_REF), sampleScores: scores, sampleCount: 3, pointsForSample: 100 })).toBe(50);
  });
});

describe('judgment summarize', () => {
  it('標準為「錯」：小組顯示判錯人數與錯因正確人數，標準顯示錯因文字', () => {
    const scores = [
      row(1, { isCorrect: false, reasonIndex: 0 }),
      row(2, { isCorrect: false, reasonIndex: 2 }),
      row(3, { isCorrect: true, reasonIndex: null }),
      row(4, { isCorrect: false, reasonIndex: 0 }),
    ];

    expect(judgmentHandler.summarize({ sample: sampleOf(WRONG_REF), sampleScores: scores })).toEqual({
      team: '判錯 3/4・錯因正確 2/4',
      ref: '錯：單位換算錯',
    });
  });

  it('標準為「對」：小組顯示判對人數', () => {
    const scores = [row(1, { isCorrect: true, reasonIndex: null }), row(2, { isCorrect: false, reasonIndex: 1 })];

    expect(judgmentHandler.summarize({ sample: sampleOf(RIGHT_REF), sampleScores: scores })).toEqual({
      team: '判對 1/2',
      ref: '對',
    });
  });
});

describe('judgment AI 生成', () => {
  const aiJson = (samples: unknown[]) => `好的，以下是題組：
{
  "topicPrompt": "小明在幫班上算園遊會的果汁用量，但是他把公升和毫升搞混了，因此請小組檢查三位同學的算法。",
  "samples": ${JSON.stringify(samples)}
}`;

  const goodSamples = [
    { content: '一杯 250 毫升，40 杯就是 250×40=10000 毫升，等於 100 公升。', refData: { isCorrect: false, reasonOptions: ['單位換算錯', '計算錯誤', '漏看條件'], correctReasonIndex: 0 } },
    { content: '250×40=10000 毫升，10000÷1000=10 公升，要買 10 公升。', refData: { isCorrect: true, reasonOptions: ['單位換算錯', '計算錯誤', '漏看條件'], correctReasonIndex: null } },
    { content: '一杯 250 毫升，40 杯是 250×40=1000 毫升，就是 1 公升。', refData: { isCorrect: false, reasonOptions: ['單位換算錯', '計算錯誤', '漏看條件'], correctReasonIndex: 1 } },
  ];

  it('合法的 AI JSON（前面夾雜說明文字）能解析成功並保留 refData', () => {
    const parsed = parseGeneratedReviewSet(aiJson(goodSamples), 'judgment');

    expect(parsed).not.toBeNull();
    expect(parsed!.samples.map(s => s.refData)).toEqual(goodSamples.map(s => s.refData));
  });

  it('refData 格式錯（標準為錯卻沒給錯因索引）→ null', () => {
    const bad = goodSamples.map((s, i) => i === 0 ? { ...s, refData: { ...s.refData, correctReasonIndex: null } } : s);

    expect(parseGeneratedReviewSet(aiJson(bad), 'judgment')).toBeNull();
  });

  it('三則全對（違反整組規則）→ null', () => {
    const allRight = goodSamples.map(s => ({ ...s, refData: { ...s.refData, isCorrect: true, correctReasonIndex: null } }));

    expect(parseGeneratedReviewSet(aiJson(allRight), 'judgment')).toBeNull();
  });

  it('aiInstruction 要求輸出 refData 並給出 JSON 範例', () => {
    expect(judgmentHandler.aiInstruction).toContain('"refData"');
    expect(judgmentHandler.aiInstruction).toContain('"correctReasonIndex"');
  });
});
