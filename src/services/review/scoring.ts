// 協作批閱計分邏輯：準確度分 + 速度加成 + 投票加成三段獨立可測試的純函式
// 重要：所有計分必須在 server 端執行（Server Action / API Route 內）

export type RubricScores = {
  correctness: number;
  completeness: number;
  clarity: number;
  creativity: number;
};

const ACCURACY_POOL_TOTAL = 1000; // 所有範例答案的準確度分總額
const ACCURACY_PENALTY_PER_POINT = 20; // 每差 1 分扣 20%（滿分 100%，差 5 分以上歸零）

/**
 * 把準確度總分平分給每則範例答案，餘數分給前面幾則（比照
 * questionActions.ts 的 distributePoints 邏輯：Math.floor + 餘數依序 +1）
 */
export function distributeAccuracyPoints(sampleCount: number): number[] {
  if (sampleCount === 0) {
    return [];
  }
  const base = Math.floor(ACCURACY_POOL_TOTAL / sampleCount);
  const remainder = ACCURACY_POOL_TOTAL - base * sampleCount;
  return Array.from({ length: sampleCount }, (_, i) => (i < remainder ? base + 1 : base));
}

function dimensionAccuracyPct(avg: number, ref: number): number {
  const diff = Math.abs(avg - ref);
  return Math.max(0, 100 - diff * ACCURACY_PENALTY_PER_POINT);
}

/**
 * 單則範例答案的準確度分：team 平均分跟老師標準分的 4 維度差距，
 * 換算成百分比後乘上這則答案的配分。
 */
export function calcAccuracyScore(
  teamAvg: RubricScores,
  ref: RubricScores,
  pointsForSample: number,
): number {
  const dims: (keyof RubricScores)[] = ['correctness', 'completeness', 'clarity', 'creativity'];
  const avgPct = dims.reduce((sum, k) => sum + dimensionAccuracyPct(teamAvg[k], ref[k]), 0) / dims.length;
  return Math.round((avgPct / 100) * pointsForSample);
}

/**
 * 速度加成：整組全員都完成評分才算「該組完成」，用完成時的剩餘時間比例
 * 計算，公式跟 Live Mode 的 calcLiveScore 同款（500 保底、最高 1000）。
 * 沒在時限內完成（elapsedSec >= totalDurationSec）拿 0。
 */
export function calcSpeedBonus(elapsedSec: number, totalDurationSec: number): number {
  if (elapsedSec >= totalDurationSec) {
    return 0;
  }
  const ratio = Math.max(0, elapsedSec) / totalDurationSec;
  const raw = 1000 * (1 - ratio * 0.5);
  return Math.max(500, Math.round(raw));
}

/** 投票加成：每收到一票（不含自己組）+100 分 */
export function calcVoteBonus(votesReceived: number): number {
  return votesReceived * 100;
}

/** 加總三段分數 */
export function calcTeamTotalScore(params: {
  accuracyScores: number[];
  speedBonus: number;
  voteBonus: number;
}): number {
  const accuracyTotal = params.accuracyScores.reduce((a, b) => a + b, 0);
  return accuracyTotal + params.speedBonus + params.voteBonus;
}
