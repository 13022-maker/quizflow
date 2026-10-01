// 非 rubric 批閱題型 → 前端元件對照表
import type { ReviewMode } from '@/services/review/modes/types';

import { ErrorSpotRefEditor, ErrorSpotReviewPanel } from './ErrorSpotMode';
import { JudgmentRefEditor, JudgmentReviewPanel } from './JudgmentMode';
import { RankingRefEditor, RankingReviewPanel } from './RankingMode';
import type { ModeUi } from './types';

const MODE_UI: Record<Exclude<ReviewMode, 'rubric'>, ModeUi> = {
  judgment: { RefEditor: JudgmentRefEditor, ReviewPanel: JudgmentReviewPanel },
  error_spot: { RefEditor: ErrorSpotRefEditor, ReviewPanel: ErrorSpotReviewPanel },
  ranking: { RefEditor: RankingRefEditor, ReviewPanel: RankingReviewPanel },
};

export function getModeUi(mode: ReviewMode): ModeUi | null {
  return mode === 'rubric' ? null : MODE_UI[mode];
}
