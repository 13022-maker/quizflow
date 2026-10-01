'use client';

// TODO(子代理)：對錯判斷 + 錯因 題型的前端元件——目前是佔位 stub
import type { RefEditorProps, ReviewPanelProps } from './types';

export function JudgmentRefEditor(_props: RefEditorProps) {
  return <p className="text-xs text-muted-foreground">此題型尚未開放</p>;
}

export function JudgmentReviewPanel(_props: ReviewPanelProps) {
  return <p className="text-xs text-muted-foreground">此題型尚未開放</p>;
}
