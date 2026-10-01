// 批閱題型的前端元件契約：每種非 rubric 題型提供兩個元件
// - RefEditor：老師在題組編輯頁設定「這則範例答案的標準答案」
// - ReviewPanel：學生在 reviewing 階段對「一則範例答案」作答
// rubric 題型沿用 ReviewSetEditor / ReviewPlayerReview 內建 UI，不走這裡。
import type { ComponentType } from 'react';

import type { ReviewSampleForClient } from '@/services/review/types';

export type ActionResult = { ok: true } | { ok: false; error: string };

export type RefEditorProps = {
  content: string; // 這則範例答案目前的內容（error_spot 要依此切句子）
  value: unknown; // 目前的 refData（可能是 undefined：新建或剛切換題型）
  onChange: (refData: unknown) => void;
  index: number; // 第幾則（0-based）
  sampleCount: number; // 題組共幾則（ranking 要用）
};

export type ReviewPanelProps = {
  sample: ReviewSampleForClient; // clientData 是題型 handler toClientData() 的產出
  sampleCount: number;
  myResponse: unknown | null; // 自己已送出的 responseData；尚未作答為 null
  myComment: string | null;
  teammates: { playerId: number; nickname: string; responseData: unknown; comment: string | null }[];
  onSubmit: (responseData: unknown, comment: string | null) => Promise<ActionResult>;
  submitting: boolean;
};

export type ModeUi = {
  RefEditor: ComponentType<RefEditorProps>;
  ReviewPanel: ComponentType<ReviewPanelProps>;
};
