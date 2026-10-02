// rubric 題型（原始做法）：4 維度 0-5 分，跟老師標準分比對差距
import type { RubricScores } from '../scoring';
import { calcAccuracyScore } from '../scoring';
import type { ModeScoreRow, ReviewModeHandler } from './types';

const DIMS: (keyof RubricScores)[] = ['correctness', 'completeness', 'clarity', 'creativity'];

export function averageRubric(rows: ModeScoreRow[]): RubricScores {
  if (rows.length === 0) {
    return { correctness: 0, completeness: 0, clarity: 0, creativity: 0 };
  }
  const avg = (k: keyof RubricScores) => rows.reduce((a, r) => a + r.rubric[k], 0) / rows.length;
  return {
    correctness: avg('correctness'),
    completeness: avg('completeness'),
    clarity: avg('clarity'),
    creativity: avg('creativity'),
  };
}

const fmt = (s: RubricScores) =>
  DIMS.map(k => Number.isInteger(s[k]) ? String(s[k]) : s[k].toFixed(1)).join('/');

export const rubricHandler: ReviewModeHandler<null, null> = {
  mode: 'rubric',
  label: '4 維度評分',
  description: '正確性／完整性／清晰度／創意各打 0–5 分，越貼近老師標準分越高分',
  refSchema: null,
  responseSchema: null,
  validateSet: () => null,
  toClientData: () => null,
  calcSampleAccuracy: ({ sample, sampleScores, pointsForSample }) =>
    calcAccuracyScore(averageRubric(sampleScores), sample.ref, pointsForSample),
  summarize: ({ sample, sampleScores }) => ({
    team: fmt(averageRubric(sampleScores)),
    ref: fmt(sample.ref),
  }),
  aiInstruction: '',
};
