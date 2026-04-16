// lib/scoring.test.ts
// vitest / jest 皆可執行

import { describe, expect, it } from 'vitest';

import {
  type Attempt,
  calcFinalScore,
  calcWeightedScore,
  canAttempt,
  previewNextAttempt,
  type QuizScoringConfig,
} from './scoring';

const mkAttempt = (n: number, score: number): Attempt => ({
  attemptNumber: n,
  rawScore: score,
  submittedAt: new Date(),
});

// ─── calcWeightedScore ───────────────────────────────────────────────────────

describe('calcWeightedScore', () => {
  it('非 decay 模式直接回傳原始分', () => {
    const cfg: QuizScoringConfig = { mode: 'highest', maxAttempts: 3 };

    expect(calcWeightedScore(80, 2, cfg)).toBe(80);
  });

  it('decay 第 1 次不衰減', () => {
    const cfg: QuizScoringConfig = { mode: 'decay', maxAttempts: 3, decayRate: 0.9 };

    expect(calcWeightedScore(100, 1, cfg)).toBe(100);
  });

  it('decay 第 2 次乘一次 rate', () => {
    const cfg: QuizScoringConfig = { mode: 'decay', maxAttempts: 3, decayRate: 0.9 };

    expect(calcWeightedScore(100, 2, cfg)).toBe(90);
  });

  it('decay 第 3 次乘兩次 rate', () => {
    const cfg: QuizScoringConfig = { mode: 'decay', maxAttempts: 3, decayRate: 0.9 };

    expect(calcWeightedScore(100, 3, cfg)).toBe(81);
  });

  it('decayRate 超出範圍時拋出錯誤', () => {
    const cfg: QuizScoringConfig = { mode: 'decay', maxAttempts: null, decayRate: 1.5 };

    expect(() => calcWeightedScore(80, 2, cfg)).toThrow(RangeError);
  });
});

// ─── calcFinalScore ──────────────────────────────────────────────────────────

describe('calcFinalScore — highest', () => {
  const cfg: QuizScoringConfig = { mode: 'highest', maxAttempts: 5 };
  const attempts = [mkAttempt(1, 62), mkAttempt(2, 78), mkAttempt(3, 91)];

  it('取最高分', () => {
    expect(calcFinalScore(attempts, cfg).finalScore).toBe(91);
  });

  it('winningAttemptNumber 正確', () => {
    expect(calcFinalScore(attempts, cfg).winningAttemptNumber).toBe(3);
  });

  it('只有第 3 次 isCounting = true', () => {
    const { attempts: scored } = calcFinalScore(attempts, cfg);

    expect(scored.filter(a => a.isCounting).length).toBe(1);
    expect(scored.find(a => a.isCounting)?.attemptNumber).toBe(3);
  });
});

describe('calcFinalScore — latest', () => {
  const cfg: QuizScoringConfig = { mode: 'latest', maxAttempts: null };
  const attempts = [mkAttempt(1, 90), mkAttempt(2, 55)];

  it('即使分數更低，仍取最後一次', () => {
    expect(calcFinalScore(attempts, cfg).finalScore).toBe(55);
  });
});

describe('calcFinalScore — first', () => {
  const cfg: QuizScoringConfig = { mode: 'first', maxAttempts: 3 };
  const attempts = [mkAttempt(1, 50), mkAttempt(2, 95)];

  it('只取第一次，不管後來分數多高', () => {
    expect(calcFinalScore(attempts, cfg).finalScore).toBe(50);
  });
});

describe('calcFinalScore — decay', () => {
  const cfg: QuizScoringConfig = { mode: 'decay', maxAttempts: 5, decayRate: 0.8 };
  // 第 1 次 60 → 60，第 2 次 90 → 72，第 3 次 100 → 64
  const attempts = [mkAttempt(1, 60), mkAttempt(2, 90), mkAttempt(3, 100)];

  it('計算各次 weightedScore 正確', () => {
    const { attempts: scored } = calcFinalScore(attempts, cfg);

    expect(scored[0]!.weightedScore).toBe(60);
    expect(scored[1]!.weightedScore).toBe(72);
    expect(scored[2]!.weightedScore).toBe(64);
  });

  it('取 weightedScore 最高的那次（第 2 次，72 分）', () => {
    expect(calcFinalScore(attempts, cfg).finalScore).toBe(72);
    expect(calcFinalScore(attempts, cfg).winningAttemptNumber).toBe(2);
  });
});

describe('calcFinalScore — isExhausted', () => {
  it('達到 maxAttempts 上限時 isExhausted = true', () => {
    const cfg: QuizScoringConfig = { mode: 'highest', maxAttempts: 2 };
    const attempts = [mkAttempt(1, 70), mkAttempt(2, 80)];

    expect(calcFinalScore(attempts, cfg).isExhausted).toBe(true);
  });

  it('maxAttempts = null 時永不 exhausted', () => {
    const cfg: QuizScoringConfig = { mode: 'highest', maxAttempts: null };
    const attempts = Array.from({ length: 50 }, (_, i) => mkAttempt(i + 1, 80));

    expect(calcFinalScore(attempts, cfg).isExhausted).toBe(false);
  });
});

// ─── canAttempt ──────────────────────────────────────────────────────────────

describe('canAttempt', () => {
  it('未達上限時允許作答', () => {
    const cfg: QuizScoringConfig = { mode: 'first', maxAttempts: 3 };

    expect(canAttempt(2, cfg)).toBe(true);
  });

  it('達到上限時拒絕作答', () => {
    const cfg: QuizScoringConfig = { mode: 'first', maxAttempts: 3 };

    expect(canAttempt(3, cfg)).toBe(false);
  });

  it('maxAttempts = null 時永遠允許', () => {
    const cfg: QuizScoringConfig = { mode: 'highest', maxAttempts: null };

    expect(canAttempt(999, cfg)).toBe(true);
  });
});

// ─── previewNextAttempt ──────────────────────────────────────────────────────

describe('previewNextAttempt', () => {
  const cfg: QuizScoringConfig = { mode: 'highest', maxAttempts: null };
  const existing = [mkAttempt(1, 70), mkAttempt(2, 80)];

  it('假設下一次 95 分，會改善成績', () => {
    const { projectedFinal, wouldImprove } = previewNextAttempt(existing, 95, cfg);

    expect(projectedFinal).toBe(95);
    expect(wouldImprove).toBe(true);
  });

  it('假設下一次 60 分，不會改善成績（highest 模式）', () => {
    const { projectedFinal, wouldImprove } = previewNextAttempt(existing, 60, cfg);

    expect(projectedFinal).toBe(80);
    expect(wouldImprove).toBe(false);
  });
});
