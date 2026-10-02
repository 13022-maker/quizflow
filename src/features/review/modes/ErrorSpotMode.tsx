'use client';

// 挑錯標註 題型的前端元件：老師標錯句（RefEditor）、學生點選錯句（ReviewPanel）
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { formatSegmentList, splitSegments } from '@/services/review/modes/errorSpot';

import type { RefEditorProps, ReviewPanelProps } from './types';

const TEXTAREA_CLASS = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

// 從 unknown 讀出索引陣列（格式不對就當空陣列），並排序去重
function readIndexes(value: unknown, key: 'errorSegmentIndexes' | 'selectedSegmentIndexes'): number[] {
  if (!value || typeof value !== 'object') {
    return [];
  }
  const arr = (value as Record<string, unknown>)[key];
  if (!Array.isArray(arr)) {
    return [];
  }
  const nums = arr.filter((v): v is number => Number.isInteger(v) && v >= 0);
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

function toggleIndex(list: number[], index: number): number[] {
  return list.includes(index) ? list.filter(i => i !== index) : [...list, index].sort((a, b) => a - b);
}

function sameList(a: number[], b: number[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function ErrorSpotRefEditor({ content, value, onChange }: RefEditorProps) {
  const segments = useMemo(() => splitSegments(content), [content]);
  const marked = readIndexes(value, 'errorSegmentIndexes');
  const valid = marked.filter(i => i < segments.length);

  // 新建／切換題型時 value 是 undefined，或內容改短導致索引越界 → 正規化一次。
  // 只有在「正規化結果跟目前值不同」時才呼叫 onChange，正規化後條件不再成立，不會造成 render 迴圈。
  const rawIndexes = value && typeof value === 'object'
    ? (value as Record<string, unknown>).errorSegmentIndexes
    : undefined;
  const needsNormalize = !Array.isArray(rawIndexes) || !sameList(rawIndexes as number[], valid);
  useEffect(() => {
    if (needsNormalize) {
      onChange({ errorSegmentIndexes: valid });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsNormalize, valid.join(',')]);

  if (segments.length === 0) {
    return <p className="text-xs text-muted-foreground">先在上方輸入範例答案內容，這裡會自動切成句子讓你標出錯句。</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        點選有錯的句子（紅底＝錯句，可多選；全對就都不選）
        {valid.length > 0 && `・目前標記：${formatSegmentList(valid)}`}
      </p>
      <div className="flex flex-wrap gap-2">
        {segments.map((seg, i) => {
          const on = valid.includes(i);
          return (
            <button
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              type="button"
              aria-pressed={on}
              onClick={() => onChange({ errorSegmentIndexes: toggleIndex(valid, i) })}
              className={`rounded-md border px-2 py-1 text-left text-sm transition-colors ${
                on
                  ? 'border-red-400 bg-red-100 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200'
                  : 'border-input bg-background hover:bg-muted'
              }`}
            >
              <span className="mr-1 text-xs text-muted-foreground">{i + 1}</span>
              {seg}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ErrorSpotReviewPanel({ sample, myResponse, myComment, teammates, onSubmit, submitting }: ReviewPanelProps) {
  const segments = useMemo(() => {
    const data = sample.clientData as { segments?: unknown } | null;
    return Array.isArray(data?.segments)
      ? data.segments.filter((s): s is string => typeof s === 'string')
      : splitSegments(sample.content);
  }, [sample.clientData, sample.content]);

  // 已送出過要回填
  const [selected, setSelected] = useState<number[]>(() =>
    readIndexes(myResponse, 'selectedSegmentIndexes').filter(i => i < segments.length));
  const [comment, setComment] = useState(myComment ?? '');
  const [saved, setSaved] = useState(myResponse !== null);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = (index: number) => {
    setSelected(prev => toggleIndex(prev, index));
    setError(null);
  };

  const handleSubmit = async () => {
    setError(null);
    const result = await onSubmit({ selectedSegmentIndexes: selected }, comment.trim() || null);
    if (result.ok) {
      setSaved(true);
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">點選你認為有錯的句子（可多選；覺得全對就都不選直接送出）</p>

      <ol className="space-y-2">
        {segments.map((seg, i) => {
          const on = selected.includes(i);
          return (
            // eslint-disable-next-line react/no-array-index-key
            <li key={i}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => handleToggle(i)}
                className={`flex min-h-11 w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                  on
                    ? 'border-red-400 bg-red-100 text-red-800 line-through decoration-red-500 dark:border-red-700 dark:bg-red-950 dark:text-red-200'
                    : 'border-input bg-background hover:bg-muted'
                }`}
              >
                <span className="shrink-0 text-xs text-muted-foreground">{i + 1}</span>
                <span className="whitespace-pre-wrap">{seg}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <p className="text-xs text-muted-foreground">
        {selected.length === 0 ? '目前沒有選任何句子（＝認為全對）' : `已選：${formatSegmentList(selected)}`}
      </p>

      <textarea
        value={comment}
        onChange={e => setComment(e.target.value)}
        rows={2}
        maxLength={200}
        placeholder="短評（選填，最多 200 字）"
        className={TEXTAREA_CLASS}
      />

      <div className="flex items-center justify-between gap-2">
        <Button onClick={handleSubmit} disabled={submitting}>
          {saved ? '更新作答' : '送出作答'}
        </Button>
        {error
          ? <span className="text-xs text-red-600">{error}</span>
          : saved && <span className="text-xs text-emerald-600">已送出</span>}
      </div>

      {teammates.length > 0 && (
        <div className="border-t pt-2 text-xs text-muted-foreground">
          <p className="mb-1">組員選擇：</p>
          <ul className="space-y-1">
            {teammates.map((t) => {
              const picks = readIndexes(t.responseData, 'selectedSegmentIndexes').filter(i => i < segments.length);
              return (
                <li key={t.playerId}>
                  {t.nickname}
                  ：
                  {picks.length === 0 ? '認為全對' : formatSegmentList(picks)}
                  {t.comment && ` — ${t.comment}`}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
