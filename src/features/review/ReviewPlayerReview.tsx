'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { RubricScores } from '@/services/review/scoring';
import type { ReviewTeamState } from '@/services/review/types';

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
  submitting: boolean;
};

export function ReviewPlayerReview({ state, onSubmitScore, submitting }: Props) {
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
