import type { KnowledgeDiagnosis } from './engine';

export type AdaptiveScoreResult = {
  score: number | null;
  totalAttempts: number;
};

// 學習後分數＝已解鎖知識點（已精熟＋學習中）的精熟度平均 ×100，排除鎖定中知識點
// 鎖定中的知識點從未派過題、mastery 永遠停在初始值，排除在外才能反映個別學生的實際差異
export function calcAdaptiveScore(diagnosis: KnowledgeDiagnosis[]): AdaptiveScoreResult {
  const unlocked = diagnosis.filter(d => d.status !== 'locked');
  return {
    score: unlocked.length > 0
      ? Math.round(
        (unlocked.reduce((sum, d) => sum + d.mastery, 0) / unlocked.length) * 100,
      )
      : null,
    // 總作答次數：加總所有知識點（含鎖定中）的作答次數，直接反映每位學生實際花的次數差異
    totalAttempts: diagnosis.reduce((sum, d) => sum + d.attempts, 0),
  };
}
