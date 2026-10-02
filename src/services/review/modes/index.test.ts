import { describe, expect, it } from 'vitest';

import { calcModeSampleAccuracy, getModeHandler, listModeHandlers } from './index';
import type { ModeSample, ModeScoreRow } from './types';

const ZERO = { correctness: 0, completeness: 0, clarity: 0, creativity: 0 };

const sample: ModeSample = {
  id: 1,
  content: '範例答案',
  orderIndex: 0,
  ref: { correctness: 3, completeness: 3, clarity: 3, creativity: 3 },
  refData: null,
};

function row(playerId: number, rubric: ModeScoreRow['rubric']): ModeScoreRow {
  return { playerId, sampleId: 1, rubric, responseData: null };
}

describe('批閱題型分派表', () => {
  it('四種題型都有註冊 handler，且 mode 欄位對得上', () => {
    const modes = listModeHandlers().map(h => h.mode);

    expect(modes).toEqual(['rubric', 'judgment', 'error_spot', 'ranking']);
    expect(getModeHandler('judgment').mode).toBe('judgment');
  });
});

describe('rubric handler（從既有計分抽出，行為不變）', () => {
  it('兩人平均 {4,3,2,3} 對標準 {3,3,3,3}、配分 250 → 各維度 80/100/80/100% 平均 90% → 225', () => {
    const scores = [
      row(1, { correctness: 5, completeness: 3, clarity: 2, creativity: 3 }),
      row(2, { correctness: 3, completeness: 3, clarity: 2, creativity: 3 }),
    ];

    expect(calcModeSampleAccuracy('rubric', { sample, sampleScores: scores, sampleCount: 4, pointsForSample: 250 })).toBe(225);
  });

  it('summarize 顯示小組平均（非整數留一位小數）與標準分', () => {
    const scores = [
      row(1, { correctness: 5, completeness: 3, clarity: 2, creativity: 3 }),
      row(2, { correctness: 4, completeness: 3, clarity: 2, creativity: 3 }),
    ];

    expect(getModeHandler('rubric').summarize({ sample, sampleScores: scores })).toEqual({
      team: '4.5/3/2/3',
      ref: '3/3/3/3',
    });
  });

  it('學生端公開資料一律為 null（不洩漏標準分）', () => {
    expect(getModeHandler('rubric').toClientData({ content: 'x', refData: null })).toBeNull();
  });
});

describe('calcModeSampleAccuracy 共用入口', () => {
  it('沒有任何作答 → 0（不呼叫題型 handler；修正報表把空作答當 0 分平均去比的舊行為）', () => {
    const lowRef: ModeSample = { ...sample, ref: ZERO };

    expect(calcModeSampleAccuracy('rubric', { sample: lowRef, sampleScores: [], sampleCount: 1, pointsForSample: 1000 })).toBe(0);
  });
});
