// lib/scoring.ts
// QuizFlow — 計分工具函式
// 支援 highest / latest / first / decay 四種模式

// ─── Types ───────────────────────────────────────────────────────────────────

export type ScoringMode = 'highest' | 'latest' | 'first' | 'decay';

export type QuizScoringConfig = {
  mode: ScoringMode;
  /** null = 無限制 */
  maxAttempts: number | null;
  /** 僅 decay 模式使用，預設 0.9（每次衰減 10%） */
  decayRate?: number;
};

export type Attempt = {
  attemptNumber: number; // 1-indexed
  rawScore: number; // 0–100
  submittedAt: Date;
};

export type ScoredAttempt = {
  weightedScore: number;
  isCounting: boolean; // 是否為最終計入的那一次
} & Attempt;

export type ScoreResult = {
  attempts: ScoredAttempt[];
  finalScore: number;
  winningAttemptNumber: number;
  totalAttempts: number;
  /** 學生是否已達作答上限 */
  isExhausted: boolean;
};

// ─── Core ────────────────────────────────────────────────────────────────────

/**
 * 計算單次作答的 weightedScore。
 * 在儲存到 quiz_attempts 前呼叫，取得要寫入 DB 的值。
 */
export function calcWeightedScore(
  rawScore: number,
  attemptNumber: number,
  config: QuizScoringConfig,
): number {
  if (config.mode !== 'decay') {
    return rawScore;
  }

  const rate = config.decayRate ?? 0.9;
  if (rate <= 0 || rate > 1) {
    throw new RangeError(`decayRate 必須介於 0（不含）到 1 之間，收到 ${rate}`);
  }

  // 第 1 次不衰減，第 2 次乘一次 rate，第 N 次乘 (N-1) 次
  const multiplier = rate ** (attemptNumber - 1);
  return round2(rawScore * multiplier);
}

/**
 * 從所有已存的 attempts 中，計算最終成績。
 * 通常在每次提交後呼叫，結果 upsert 進 quiz_final_scores。
 */
export function calcFinalScore(
  attempts: Attempt[],
  config: QuizScoringConfig,
): ScoreResult {
  if (attempts.length === 0) {
    throw new Error('attempts 不可為空陣列');
  }

  // 確保照順序排列
  const sorted = [...attempts].sort((a, b) => a.attemptNumber - b.attemptNumber);

  // 附上 weightedScore
  const scored: ScoredAttempt[] = sorted.map(a => ({
    ...a,
    weightedScore: calcWeightedScore(a.rawScore, a.attemptNumber, config),
    isCounting: false,
  }));

  // 找出計入的那一次
  const winnerIdx = resolveWinnerIndex(scored, config.mode);
  scored[winnerIdx]!.isCounting = true;

  const winner = scored[winnerIdx]!;
  const isExhausted
    = config.maxAttempts !== null && sorted.length >= config.maxAttempts;

  return {
    attempts: scored,
    finalScore: winner.weightedScore,
    winningAttemptNumber: winner.attemptNumber,
    totalAttempts: sorted.length,
    isExhausted,
  };
}

/**
 * 在學生送出答案前，檢查是否還有作答資格。
 * 回傳 true 代表允許作答。
 */
export function canAttempt(
  currentAttemptCount: number,
  config: QuizScoringConfig,
): boolean {
  if (config.maxAttempts === null) {
    return true;
  }
  return currentAttemptCount < config.maxAttempts;
}

/**
 * 給學生看的「再答一次會怎樣」預覽。
 * 傳入假設的下一次 rawScore，回傳對最終成績的影響。
 */
export function previewNextAttempt(
  existingAttempts: Attempt[],
  hypotheticalScore: number,
  config: QuizScoringConfig,
): { projectedFinal: number; wouldImprove: boolean } {
  const nextAttemptNumber
    = existingAttempts.length > 0
      ? Math.max(...existingAttempts.map(a => a.attemptNumber)) + 1
      : 1;

  const hypothetical: Attempt = {
    attemptNumber: nextAttemptNumber,
    rawScore: hypotheticalScore,
    submittedAt: new Date(),
  };

  const current
    = existingAttempts.length > 0
      ? calcFinalScore(existingAttempts, config).finalScore
      : 0;

  const projected = calcFinalScore(
    [...existingAttempts, hypothetical],
    config,
  ).finalScore;

  return {
    projectedFinal: projected,
    wouldImprove: projected > current,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveWinnerIndex(
  scored: ScoredAttempt[],
  mode: ScoringMode,
): number {
  switch (mode) {
    case 'highest':
    case 'decay':
      // decay 模式：weightedScore 已含衰減，直接取最高
      return scored.reduce(
        (bestIdx, a, i) =>
          a.weightedScore > scored[bestIdx]!.weightedScore ? i : bestIdx,
        0,
      );
    case 'latest':
      return scored.length - 1;
    case 'first':
      return 0;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
