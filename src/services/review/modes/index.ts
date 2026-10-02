// 批閱題型分派表：新增題型時只要在這裡註冊 handler
import { errorSpotHandler } from './errorSpot';
import { judgmentHandler } from './judgment';
import { rankingHandler } from './ranking';
import { rubricHandler } from './rubric';
import type { ModeSample, ModeScoreRow, ReviewMode, ReviewModeHandler } from './types';

export * from './types';

const HANDLERS: Record<ReviewMode, ReviewModeHandler> = {
  rubric: rubricHandler as ReviewModeHandler,
  judgment: judgmentHandler,
  error_spot: errorSpotHandler,
  ranking: rankingHandler,
};

export function getModeHandler(mode: ReviewMode): ReviewModeHandler {
  return HANDLERS[mode];
}

export function listModeHandlers(): ReviewModeHandler[] {
  return Object.values(HANDLERS);
}

/**
 * 單則範例答案的準確度分（所有題型共用入口）：沒人作答直接 0，
 * 有作答才交給題型 handler 算，並 clamp 在 0..pointsForSample 的整數。
 */
export function calcModeSampleAccuracy(
  mode: ReviewMode,
  params: { sample: ModeSample; sampleScores: ModeScoreRow[]; sampleCount: number; pointsForSample: number },
): number {
  if (params.sampleScores.length === 0) {
    return 0;
  }
  const raw = getModeHandler(mode).calcSampleAccuracy(params);
  return Math.min(params.pointsForSample, Math.max(0, Math.round(raw)));
}
