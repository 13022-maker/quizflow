import { describe, expect, it } from 'vitest';

import { parseGeneratedReviewSet } from '@/lib/ai/reviewSetGeneration';
import { validateReviewSetModes } from '@/lib/reviewSetSchema';

import { calcModeSampleAccuracy } from './index';
import { rankingHandler } from './ranking';
import type { ModeSample, ModeScoreRow } from './types';

const ZERO = { correctness: 0, completeness: 0, clarity: 0, creativity: 0 };

function sampleWithRank(rank: unknown): ModeSample {
  return { id: 1, content: '範例答案', orderIndex: 0, ref: ZERO, refData: rank === undefined ? undefined : { rank } };
}

function row(playerId: number, rank: unknown): ModeScoreRow {
  return { playerId, sampleId: 1, rubric: ZERO, responseData: { rank } };
}

const set = (...ranks: unknown[]) => ranks.map((rank, i) => ({ content: `第 ${i + 1} 則`, refData: { rank } }));

describe('ranking refSchema / responseSchema', () => {
  it('refData 必須是正整數名次', () => {
    expect(rankingHandler.refSchema!.safeParse({ rank: 1 }).success).toBe(true);
    expect(rankingHandler.refSchema!.safeParse({ rank: 0 }).success).toBe(false);
    expect(rankingHandler.refSchema!.safeParse({ rank: 1.5 }).success).toBe(false);
    expect(rankingHandler.refSchema!.safeParse(undefined).success).toBe(false);
  });

  it('responseData 名次只能是 1–10 整數', () => {
    expect(rankingHandler.responseSchema!.safeParse({ rank: 10 }).success).toBe(true);
    expect(rankingHandler.responseSchema!.safeParse({ rank: 11 }).success).toBe(false);
    expect(rankingHandler.responseSchema!.safeParse({ rank: 0 }).success).toBe(false);
    expect(rankingHandler.responseSchema!.safeParse({ rank: '2' }).success).toBe(false);
  });
});

describe('ranking validateSet', () => {
  it('名次剛好是 1..N 各一次 → 通過（順序不限）', () => {
    expect(rankingHandler.validateSet(set(3, 1, 2))).toBeNull();
  });

  it('只有 1 則 → 擋下', () => {
    expect(rankingHandler.validateSet(set(1))).toContain('至少要有 2 則');
  });

  it('名次重複 → 指出重複與缺少的名次', () => {
    const err = rankingHandler.validateSet(set(1, 2, 2));

    expect(err).toContain('名次 2 重複');
    expect(err).toContain('缺少名次 3');
  });

  it('名次超出範圍 → 指出超出的名次', () => {
    const err = rankingHandler.validateSet(set(1, 4));

    expect(err).toContain('名次 4 超出範圍');
    expect(err).toContain('缺少名次 2');
  });

  it('某則沒設名次 → 擋下', () => {
    const err = rankingHandler.validateSet([{ content: 'a', refData: { rank: 1 } }, { content: 'b', refData: null }]);

    expect(err).toContain('第 2 則');
  });
});

describe('ranking toClientData', () => {
  it('一律回 null，不洩漏標準名次', () => {
    expect(rankingHandler.toClientData({ content: 'x', refData: { rank: 1 } })).toBeNull();
  });
});

describe('ranking calcSampleAccuracy', () => {
  it('N=3、標準第 2 名，兩人排 1、2 → (1−1/2 + 1−0/2)/2 = 0.75 × 200 = 150', () => {
    const scores = [row(1, 1), row(2, 2)];

    expect(calcModeSampleAccuracy('ranking', { sample: sampleWithRank(2), sampleScores: scores, sampleCount: 3, pointsForSample: 200 })).toBe(150);
  });

  it('N=4、標準第 1 名，排 4（0）、2（1−1/3）、5 超出範圍（0）→ (2/3)/3 = 0.2222 × 300 = 66.67 → 67', () => {
    const scores = [row(1, 4), row(2, 2), row(3, 5)];

    expect(calcModeSampleAccuracy('ranking', { sample: sampleWithRank(1), sampleScores: scores, sampleCount: 4, pointsForSample: 300 })).toBe(67);
  });

  it('N=2、標準第 2 名，一人排 1 → 1 − 1/1 = 0 → 0', () => {
    expect(calcModeSampleAccuracy('ranking', { sample: sampleWithRank(2), sampleScores: [row(1, 1)], sampleCount: 2, pointsForSample: 500 })).toBe(0);
  });

  it('N=1 → 排第 1 名就 100%：1 × 250 = 250', () => {
    expect(calcModeSampleAccuracy('ranking', { sample: sampleWithRank(1), sampleScores: [row(1, 1)], sampleCount: 1, pointsForSample: 250 })).toBe(250);
  });

  it('作答格式壞掉（server 不信任 client）→ 該人 0%：(0 + 1)/2 × 100 = 50', () => {
    const scores = [{ ...row(1, 1), responseData: 'garbage' }, row(2, 1)];

    expect(calcModeSampleAccuracy('ranking', { sample: sampleWithRank(1), sampleScores: scores, sampleCount: 3, pointsForSample: 100 })).toBe(50);
  });

  it('標準名次缺漏 → 0', () => {
    expect(calcModeSampleAccuracy('ranking', { sample: sampleWithRank(undefined), sampleScores: [row(1, 1)], sampleCount: 3, pointsForSample: 100 })).toBe(0);
  });
});

describe('ranking summarize', () => {
  it('平均 (1+2)/2 = 1.5 → 「平均第 1.5 名」，標準「第 2 名」', () => {
    expect(rankingHandler.summarize({ sample: sampleWithRank(2), sampleScores: [row(1, 1), row(2, 2)] })).toEqual({
      team: '平均第 1.5 名',
      ref: '第 2 名',
    });
  });

  it('平均是整數就不帶小數：(1+3)/2 = 2 → 「平均第 2 名」', () => {
    expect(rankingHandler.summarize({ sample: sampleWithRank(3), sampleScores: [row(1, 1), row(2, 3)] }).team).toBe('平均第 2 名');
  });

  it('非整數只留一位小數：(1+1+2)/3 = 1.333 → 「平均第 1.3 名」', () => {
    expect(rankingHandler.summarize({ sample: sampleWithRank(1), sampleScores: [row(1, 1), row(2, 1), row(3, 2)] }).team).toBe('平均第 1.3 名');
  });

  it('沒有作答 → 「-」', () => {
    expect(rankingHandler.summarize({ sample: sampleWithRank(1), sampleScores: [] }).team).toBe('-');
  });
});

describe('ranking 整合：題組驗證與 AI 生成', () => {
  const base = {
    title: 't',
    topicPrompt: 'p',
    teamSize: 4,
    reviewDurationSec: 300,
    createDurationSec: 300,
    reviewMode: 'ranking' as const,
    createMode: 'free_text' as const,
  };
  const s = (refData: unknown) => ({ content: 'c', ref: ZERO, isAiAnswer: false, refData });

  it('validateReviewSetModes：合法名次通過，refData 未設定時回報第幾則', () => {
    expect(validateReviewSetModes({ ...base, samples: [s({ rank: 2 }), s({ rank: 1 })] }).ok).toBe(true);

    const bad = validateReviewSetModes({ ...base, samples: [s({ rank: 1 }), s(undefined)] });

    expect(bad.ok).toBe(false);
    expect(bad.ok ? '' : bad.error).toContain('第 2 則範例答案');
  });

  it('aiInstruction 要求輸出 refData.rank', () => {
    expect(rankingHandler.aiInstruction).toContain('"refData"');
    expect(rankingHandler.aiInstruction).toContain('"rank"');
  });

  const aiJson = (ranks: number[]) => JSON.stringify({
    topicPrompt: '故事情境與任務',
    samples: ranks.map((rank, i) => ({
      content: `第 ${i + 1} 則範例答案`,
      ref: { correctness: i + 1, completeness: i + 1, clarity: i + 1, creativity: i + 1 },
      refData: { rank },
    })),
  });

  it('假 AI 回應（前後夾雜文字）名次 3/2/1 → 解析成功並保留名次', () => {
    const parsed = parseGeneratedReviewSet(`好的，以下是題組：\n${aiJson([3, 2, 1])}\n完成`, 'ranking');

    expect(parsed?.samples.map(x => x.refData)).toEqual([{ rank: 3 }, { rank: 2 }, { rank: 1 }]);
  });

  it('假 AI 回應名次重複 → null', () => {
    expect(parseGeneratedReviewSet(aiJson([3, 1, 1]), 'ranking')).toBeNull();
  });

  it('假 AI 回應缺 refData → null', () => {
    const raw = JSON.stringify({ topicPrompt: 'p', samples: [1, 2, 3].map(() => ({ content: 'c', ref: ZERO })) });

    expect(parseGeneratedReviewSet(raw, 'ranking')).toBeNull();
  });
});
