'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { ReviewSetInput } from '@/actions/reviewSetActions';
import { createReviewSet, updateReviewSet } from '@/actions/reviewSetActions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listCreateModes } from '@/services/review/createModes';
import type { ReviewCreateMode, ReviewMode } from '@/services/review/modes';
import { listModeHandlers } from '@/services/review/modes';

import { getModeUi } from './modes/registry';

const TEXTAREA_CLASS = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

type SampleForm = {
  content: string;
  ref: { correctness: number; completeness: number; clarity: number; creativity: number };
  isAiAnswer: boolean;
  refData?: unknown; // 非 rubric 題型的標準答案
};

type Props = {
  reviewSetId?: number;
  initial?: ReviewSetInput;
};

const EMPTY_SAMPLE: SampleForm = {
  content: '',
  ref: { correctness: 3, completeness: 3, clarity: 3, creativity: 3 },
  isAiAnswer: false,
};

// 主題/框架選填：比照 quiz AI 出題的 FRAMEWORK_PROMPTS 下拉選單模式，目前只有一個選項
const FRAMEWORK_OPTIONS: Record<string, string> = {
  'ai-era-thinking': 'AI 時代思考（挑戰超越 AI 解答）',
};

const DIMENSION_LABEL: Record<keyof SampleForm['ref'], string> = {
  correctness: '正確性',
  completeness: '完整性',
  clarity: '清晰度',
  creativity: '創意',
};

// 評分範圍固定 0-5 分，對應單一點擊的按鈕列
const SCORE_OPTIONS = [0, 1, 2, 3, 4, 5] as const;

export function ReviewSetEditor({ reviewSetId, initial }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [topicPrompt, setTopicPrompt] = useState(initial?.topicPrompt ?? '');
  const [teamSize, setTeamSize] = useState(initial?.teamSize ?? 4);
  const [reviewDurationSec, setReviewDurationSec] = useState(initial?.reviewDurationSec ?? 600);
  const [createDurationSec, setCreateDurationSec] = useState(initial?.createDurationSec ?? 300);
  const [samples, setSamples] = useState<SampleForm[]>(
    initial?.samples.map(s => ({
      content: s.content,
      ref: s.ref ?? EMPTY_SAMPLE.ref,
      isAiAnswer: s.isAiAnswer ?? false,
      refData: s.refData,
    })) ?? [EMPTY_SAMPLE],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiUpgradeRequired, setAiUpgradeRequired] = useState(false);
  const [framework, setFramework] = useState<string>('');
  const [reviewMode, setReviewMode] = useState<ReviewMode>(initial?.reviewMode ?? 'rubric');
  const [createMode, setCreateMode] = useState<ReviewCreateMode>(initial?.createMode ?? 'free_text');
  const modeUi = getModeUi(reviewMode);
  const modeHandlers = listModeHandlers();
  const currentModeHandler = modeHandlers.find(h => h.mode === reviewMode);
  const createModes = listCreateModes();

  const handleAiGenerate = async () => {
    setAiError(null);
    setAiUpgradeRequired(false);
    setAiGenerating(true);
    try {
      const res = await fetch('/api/ai/generate-review-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, framework: framework || undefined, reviewMode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.upgradeRequired) {
          setAiUpgradeRequired(true);
        }
        setAiError(data.error ?? 'AI 生成失敗，請重試');
        return;
      }
      setTopicPrompt(data.topicPrompt);
      setSamples(data.samples);
    } catch {
      setAiError('網路錯誤，請重試');
    } finally {
      setAiGenerating(false);
    }
  };

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
      reviewMode,
      createMode,
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="reviewMode">批閱題型</label>
          <select
            id="reviewMode"
            value={reviewMode}
            onChange={e => setReviewMode(e.target.value as ReviewMode)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {modeHandlers.map(h => (
              <option key={h.mode} value={h.mode}>{h.label}</option>
            ))}
          </select>
          {currentModeHandler && (
            <p className="text-xs text-muted-foreground">{currentModeHandler.description}</p>
          )}
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="createMode">小組共創產出</label>
          <select
            id="createMode"
            value={createMode}
            onChange={e => setCreateMode(e.target.value as ReviewCreateMode)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {createModes.map(m => (
              <option key={m.mode} value={m.mode}>{m.label}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {createModes.find(m => m.mode === createMode)?.description}
          </p>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-dashed p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            填好標題後，可以用 AI 一鍵產生延伸創作指示與 3 則品質不同的範例答案（會覆蓋下面目前的內容）
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <select
              value={framework}
              onChange={e => setFramework(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs"
              title="主題／框架（選填）：套用特定教學理念的生成邏輯"
            >
              <option value="">不指定主題</option>
              {Object.entries(FRAMEWORK_OPTIONS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!title.trim() || aiGenerating}
              onClick={handleAiGenerate}
            >
              {aiGenerating ? '產生中⋯' : '🤖 AI 一鍵產生'}
            </Button>
          </div>
        </div>
        {aiError && (
          <p className="text-xs text-destructive">
            {aiError}
            {aiUpgradeRequired && '（升級 Pro 方案即可無限使用）'}
          </p>
        )}
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
            {modeUi && (
              <modeUi.RefEditor
                content={sample.content}
                value={sample.refData}
                onChange={refData => updateSample(i, { refData })}
                index={i}
                sampleCount={samples.length}
              />
            )}
            <div className={reviewMode === 'rubric' ? 'space-y-2' : 'hidden'}>
              {(Object.keys(DIMENSION_LABEL) as (keyof SampleForm['ref'])[]).map(key => (
                <div key={key} className="flex items-center gap-2">
                  <label className="w-12 shrink-0 text-xs text-muted-foreground">{DIMENSION_LABEL[key]}</label>
                  <div className="flex gap-1">
                    {SCORE_OPTIONS.map(score => (
                      <Button
                        key={score}
                        type="button"
                        size="sm"
                        variant={sample.ref[key] === score ? 'default' : 'outline'}
                        className="size-7 p-0 text-xs"
                        onClick={() => updateSampleRef(i, key, score)}
                      >
                        {score}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={sample.isAiAnswer}
                onChange={e => updateSample(i, { isAiAnswer: e.target.checked })}
              />
              標示為「AI 生成的解答」（學生評分時會看到明顯標示）
            </label>
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
