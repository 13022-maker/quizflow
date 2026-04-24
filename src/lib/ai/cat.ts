/**
 * 自適應測驗（CAT, Computerized Adaptive Testing）— 簡化版
 *
 * 演算法：簡版 IRT（Rasch model）+ Elo-style ability update
 * - 能力 theta 範圍：-3（最弱）～ +3（最強），預設起始 0
 * - 題目難度 b：以 1–5 整數儲存於 question.difficulty，內部映射為 -2 ～ +2 的 b 值
 * - 答題後 theta 用 Elo-style 公式更新（k = 0.4，會隨答題數遞減）
 * - 下一題從未答過的題目中挑「難度與當前 theta 最接近」者
 * - 收斂條件：達到目標題數 / 題庫枯竭 / 連續 3 題能力變化 < 0.1
 *
 * 設計原則：完全 stateless（state 在 client 端 history 中），server 端僅做計算
 * → 無需新建表、無需 Redis，最小破壞性
 */

export type AdaptiveQuestionMeta = {
  id: number;
  difficulty: number; // 1–5 (DB 儲存值)
};

export type AdaptiveAnswer = {
  questionId: number;
  difficulty: number; // 1–5
  isCorrect: boolean;
};

/**
 * 把 DB 的 difficulty (1–5) 映射成 IRT 的 b 值 (-2 ～ +2)
 * 1 → -2, 2 → -1, 3 → 0, 4 → +1, 5 → +2
 */
export function difficultyToB(difficulty: number): number {
  const clamped = Math.max(1, Math.min(5, Math.round(difficulty)));
  return clamped - 3;
}

/**
 * Rasch model 答對機率：P(correct) = 1 / (1 + exp(b - theta))
 */
export function probabilityCorrect(theta: number, difficulty: number): number {
  const b = difficultyToB(difficulty);
  return 1 / (1 + Math.exp(b - theta));
}

/**
 * Elo-style theta 更新
 * - 預期答對機率 P 越高、實際答錯，theta 下降越多（被該題打臉）
 * - learningRate 隨答題數遞減：k = 0.6 / (1 + 0.15 * n)，前期收斂快、後期穩定
 */
export function updateAbility(
  prevTheta: number,
  difficulty: number,
  isCorrect: boolean,
  answeredCount: number,
): number {
  const expected = probabilityCorrect(prevTheta, difficulty);
  const actual = isCorrect ? 1 : 0;
  const k = 0.6 / (1 + 0.15 * answeredCount);
  // 限縮在 [-3, +3]，避免極端題庫單題打飛 theta
  const next = prevTheta + k * (actual - expected);
  return Math.max(-3, Math.min(3, next));
}

/**
 * 從歷史答題重新計算最終 theta（用於 server 收口存入 response.estimatedAbility）
 * client 端送來的 currentAbility 不可信任，server 一律重算
 */
export function recomputeAbility(history: AdaptiveAnswer[]): number {
  let theta = 0;
  history.forEach((ans, idx) => {
    theta = updateAbility(theta, ans.difficulty, ans.isCorrect, idx);
  });
  return theta;
}

/**
 * 從候選題庫中挑下一題：難度與當前 theta 最接近者
 * - 排除已答過的題目
 * - 若有多題難度相同，隨機選一題（避免每位學生路徑完全相同）
 */
export function selectNextQuestion(
  pool: AdaptiveQuestionMeta[],
  answeredIds: Set<number>,
  currentAbility: number,
): AdaptiveQuestionMeta | null {
  const remaining = pool.filter(q => !answeredIds.has(q.id));
  if (remaining.length === 0) {
    return null;
  }

  // 計算每題難度與 theta 的距離，找最小值
  const withDist = remaining.map(q => ({
    q,
    dist: Math.abs(difficultyToB(q.difficulty) - currentAbility),
  }));
  const minDist = Math.min(...withDist.map(x => x.dist));
  // 0.01 容差：浮點數比較
  const closest = withDist.filter(x => x.dist - minDist < 0.01).map(x => x.q);
  // 隨機選一題
  return closest[Math.floor(Math.random() * closest.length)] ?? null;
}

/**
 * 是否該停止：題數達標 / 題庫耗盡 / theta 已收斂（最近 3 題變化 < 0.1）
 */
export function shouldStop(
  history: AdaptiveAnswer[],
  poolSize: number,
  targetCount: number,
): { stop: boolean; reason: 'target' | 'pool' | 'converged' | null } {
  if (history.length >= poolSize) {
    return { stop: true, reason: 'pool' };
  }
  if (history.length >= targetCount) {
    return { stop: true, reason: 'target' };
  }
  // 至少答 5 題後才檢查收斂
  if (history.length >= 5) {
    const last3 = history.slice(-3);
    let theta = recomputeAbility(history.slice(0, -3));
    let maxDelta = 0;
    last3.forEach((ans, i) => {
      const next = updateAbility(theta, ans.difficulty, ans.isCorrect, history.length - 3 + i);
      maxDelta = Math.max(maxDelta, Math.abs(next - theta));
      theta = next;
    });
    if (maxDelta < 0.1) {
      return { stop: true, reason: 'converged' };
    }
  }
  return { stop: false, reason: null };
}

/**
 * 把最終 theta 翻譯成「等級描述」供學生 / 老師理解（中文）
 */
export function abilityToLevel(theta: number): { label: string; description: string; percentile: number } {
  // 假設常態分佈，theta 對應百分位
  // theta = 0 → 50%, theta = 1 → ~84%, theta = -1 → ~16%
  const percentile = Math.round(100 * cdf(theta));
  if (theta >= 1.5) {
    return { label: '卓越', description: '已超越大多數同儕，建議挑戰更高難度題目', percentile };
  }
  if (theta >= 0.5) {
    return { label: '進階', description: '掌握度良好，可嘗試延伸應用題', percentile };
  }
  if (theta >= -0.5) {
    return { label: '中等', description: '基本概念已具備，需多加練習以鞏固', percentile };
  }
  if (theta >= -1.5) {
    return { label: '初階', description: '建議重新複習基礎概念再進階', percentile };
  }
  return { label: '需加強', description: '建議從基本知識開始，找老師或助教協助', percentile };
}

// 標準常態分佈累積機率（CDF），近似公式（Abramowitz & Stegun 26.2.17）
function cdf(z: number): number {
  const p = 0.2316419;
  const b1 = 0.319381530;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const t = 1 / (1 + p * Math.abs(z));
  const pdf = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
  const cdfRight = 1 - pdf * (b1 * t + b2 * t ** 2 + b3 * t ** 3 + b4 * t ** 4 + b5 * t ** 5);
  return z >= 0 ? cdfRight : 1 - cdfRight;
}
