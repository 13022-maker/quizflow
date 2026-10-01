'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { RubricScores } from '@/services/review/scoring';
import type { ReviewTeamState } from '@/services/review/types';

import { getModeUi } from './modes/registry';
import type { ActionResult } from './modes/types';

const TEXTAREA_CLASS = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

const DIMENSION_LABEL: Record<keyof RubricScores, string> = {
  correctness: '正確性',
  completeness: '完整性',
  clarity: '清晰度',
  creativity: '創意',
};

type ScoreDraft = RubricScores & { comment: string };

type Props = {
  state: ReviewTeamState;
  onSubmitScore: (
    sampleId: number,
    scores: RubricScores,
    comment: string | null,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onSubmitResponse: (sampleId: number, responseData: unknown, comment: string | null) => Promise<ActionResult>;
  submitting: boolean;
};

const MODE_TITLE: Record<ReviewTeamState['reviewMode'], string> = {
  rubric: '評分範例答案',
  judgment: '判斷範例答案的對錯',
  error_spot: '找出範例答案中的錯誤',
  ranking: '幫範例答案排名次',
};

export function ReviewPlayerReview({ state, onSubmitScore, onSubmitResponse, submitting }: Props) {
  const modeUi = getModeUi(state.reviewMode);
  if (modeUi) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
        <h1 className="text-lg font-bold">{MODE_TITLE[state.reviewMode]}</h1>
        {state.samples.map((sample) => {
          const mine = state.myScores[sample.id];
          return (
            <div key={sample.id} className="space-y-3 rounded-lg border p-4">
              {sample.isAiAnswer && (
                <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
                  🤖 這是 AI 生成的解答
                </span>
              )}
              <modeUi.ReviewPanel
                sample={sample}
                sampleCount={state.samples.length}
                myResponse={mine?.responseData ?? null}
                myComment={mine?.comment ?? null}
                teammates={(state.teammateScores[sample.id] ?? []).map(t => ({
                  playerId: t.playerId,
                  nickname: t.nickname,
                  responseData: t.responseData,
                  comment: t.comment,
                }))}
                onSubmit={(responseData, comment) => onSubmitResponse(sample.id, responseData, comment)}
                submitting={submitting}
              />
            </div>
          );
        })}
      </div>
    );
  }

  return <RubricReview state={state} onSubmitScore={onSubmitScore} submitting={submitting} />;
}

function RubricReview({ state, onSubmitScore, submitting }: Omit<Props, 'onSubmitResponse'>) {
  const [drafts, setDrafts] = useState<Record<number, ScoreDraft>>({});
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());

  const getDraft = (sampleId: number): ScoreDraft => {
    const draft = drafts[sampleId];
    if (draft) {
      return draft;
    }
    const existing = state.myScores[sampleId];
    return existing
      ? { ...existing, comment: existing.comment ?? '' }
      : { correctness: 3, completeness: 3, clarity: 3, creativity: 3, comment: '' };
  };

  const updateDraft = (sampleId: number, patch: Partial<ScoreDraft>) => {
    setDrafts(prev => ({ ...prev, [sampleId]: { ...getDraft(sampleId), ...patch } }));
  };

  const handleSubmit = async (sampleId: number) => {
    const draft = getDraft(sampleId);
    const result = await onSubmitScore(
      sampleId,
      {
        correctness: draft.correctness,
        completeness: draft.completeness,
        clarity: draft.clarity,
        creativity: draft.creativity,
      },
      draft.comment.trim() || null,
    );
    if (result.ok) {
      setSavedIds(prev => new Set(prev).add(sampleId));
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <h1 className="text-lg font-bold">評分範例答案</h1>

      {state.samples.map((sample) => {
        const draft = getDraft(sample.id);
        const alreadySaved = !!state.myScores[sample.id] || savedIds.has(sample.id);
        const teammates = state.teammateScores[sample.id] ?? [];

        return (
          <div key={sample.id} className="space-y-3 rounded-lg border p-4">
            {sample.isAiAnswer && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
                🤖 這是 AI 生成的解答
              </span>
            )}
            <p className="whitespace-pre-wrap text-sm">{sample.content}</p>

            <div className="grid grid-cols-4 gap-2">
              {(Object.keys(DIMENSION_LABEL) as (keyof RubricScores)[]).map(key => (
                <div key={key} className="space-y-1">
                  <label className="text-xs text-muted-foreground">{DIMENSION_LABEL[key]}</label>
                  <Input
                    type="number"
                    min={0}
                    max={5}
                    value={draft[key]}
                    onChange={e =>
                      updateDraft(sample.id, { [key]: Number(e.target.value) } as Partial<ScoreDraft>)}
                  />
                </div>
              ))}
            </div>

            <textarea
              value={draft.comment}
              onChange={e => updateDraft(sample.id, { comment: e.target.value })}
              rows={2}
              maxLength={200}
              placeholder="短評（選填，最多 200 字）"
              className={TEXTAREA_CLASS}
            />

            <div className="flex items-center justify-between">
              <Button size="sm" onClick={() => handleSubmit(sample.id)} disabled={submitting}>
                {alreadySaved ? '更新評分' : '送出評分'}
              </Button>
              {alreadySaved && <span className="text-xs text-emerald-600">已送出</span>}
            </div>

            {teammates.length > 0 && (
              <div className="border-t pt-2 text-xs text-muted-foreground">
                <p className="mb-1">組員評分：</p>
                <ul className="space-y-1">
                  {teammates.map(t => (
                    <li key={t.playerId}>
                      {t.nickname}
                      ：正
                      {t.correctness}
                      /完
                      {t.completeness}
                      /清
                      {t.clarity}
                      /創
                      {t.creativity}
                      {t.comment && ` — ${t.comment}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
