'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { ReviewSetInput } from '@/actions/reviewSetActions';
import { createReviewSet, updateReviewSet } from '@/actions/reviewSetActions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const TEXTAREA_CLASS = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

type SampleForm = {
  content: string;
  ref: { correctness: number; completeness: number; clarity: number; creativity: number };
};

type Props = {
  reviewSetId?: number;
  initial?: ReviewSetInput;
};

const EMPTY_SAMPLE: SampleForm = {
  content: '',
  ref: { correctness: 3, completeness: 3, clarity: 3, creativity: 3 },
};

const DIMENSION_LABEL: Record<keyof SampleForm['ref'], string> = {
  correctness: '正確性',
  completeness: '完整性',
  clarity: '清晰度',
  creativity: '創意',
};

export function ReviewSetEditor({ reviewSetId, initial }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [topicPrompt, setTopicPrompt] = useState(initial?.topicPrompt ?? '');
  const [teamSize, setTeamSize] = useState(initial?.teamSize ?? 4);
  const [reviewDurationSec, setReviewDurationSec] = useState(initial?.reviewDurationSec ?? 600);
  const [createDurationSec, setCreateDurationSec] = useState(initial?.createDurationSec ?? 300);
  const [samples, setSamples] = useState<SampleForm[]>(initial?.samples ?? [EMPTY_SAMPLE]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const updateSample = (i: number, patch: Partial<SampleForm>) => {
    setSamples(prev => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };
  const updateSampleRef = (i: number, key: keyof SampleForm['ref'], value: number) => {
    setSamples(prev => prev.map((s, idx) => (idx === i ? { ...s, ref: { ...s.ref, [key]: value } } : s)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const input: ReviewSetInput = {
      title,
      topicPrompt,
      teamSize,
      reviewDurationSec,
      createDurationSec,
      samples,
    };
    const result = reviewSetId
      ? await updateReviewSet(reviewSetId, input)
      : await createReviewSet(input);
    setSaving(false);
    if ('error' in result && result.error) {
      setError(result.error);
      return;
    }
    router.push('/dashboard/review');
  };

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="title">標題</label>
        <Input id="title" value={title} onChange={e => setTitle(e.target.value)} required />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="topicPrompt">給小組的延伸創作指示</label>
        <textarea
          id="topicPrompt"
          value={topicPrompt}
          onChange={e => setTopicPrompt(e.target.value)}
          rows={3}
          className={TEXTAREA_CLASS}
          required
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="teamSize">小組人數</label>
          <Input
            id="teamSize"
            type="number"
            min={2}
            max={8}
            value={teamSize}
            onChange={e => setTeamSize(Number(e.target.value))}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="reviewDurationSec">評分回合秒數</label>
          <Input
            id="reviewDurationSec"
            type="number"
            min={60}
            max={3600}
            value={reviewDurationSec}
            onChange={e => setReviewDurationSec(Number(e.target.value))}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="createDurationSec">共創回合秒數</label>
          <Input
            id="createDurationSec"
            type="number"
            min={60}
            max={3600}
            value={createDurationSec}
            onChange={e => setCreateDurationSec(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">範例答案（最多 10 則）</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={samples.length >= 10}
            onClick={() => setSamples(prev => [...prev, EMPTY_SAMPLE])}
          >
            + 新增範例答案
          </Button>
        </div>

        {samples.map((sample, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                範例答案 #
                {i + 1}
              </span>
              {samples.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSamples(prev => prev.filter((_, idx) => idx !== i))}
                >
                  刪除
                </Button>
              )}
            </div>
            <textarea
              value={sample.content}
              onChange={e => updateSample(i, { content: e.target.value })}
              rows={4}
              placeholder="貼上這則範例答案的內容"
              className={TEXTAREA_CLASS}
              required
            />
            <div className="grid grid-cols-4 gap-3">
              {(Object.keys(DIMENSION_LABEL) as (keyof SampleForm['ref'])[]).map(key => (
                <div key={key} className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    {DIMENSION_LABEL[key]}
                    （0-5）
                  </label>
                  <Input
                    type="number"
                    min={0}
                    max={5}
                    value={sample.ref[key]}
                    onChange={e => updateSampleRef(i, key, Number(e.target.value))}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      <Button type="submit" disabled={saving}>
        {saving ? '儲存中⋯' : '儲存'}
      </Button>
    </form>
  );
}
