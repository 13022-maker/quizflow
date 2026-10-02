'use client';

// 排序比較 題型的前端元件：
// - RankingRefEditor：老師設定這則範例答案的「標準名次」
// - RankingReviewPanel：學生對一則範例答案選名次（1..sampleCount）＋短評
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

import type { RefEditorProps, ReviewPanelProps } from './types';

const TEXTAREA_CLASS = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const SELECT_CLASS = 'h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const COMMENT_MAX = 200;

/** 安全讀出 { rank: 正整數 }；格式不合回 null */
function readRank(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const rank = (data as { rank?: unknown }).rank;
  return typeof rank === 'number' && Number.isInteger(rank) && rank > 0 ? rank : null;
}

const range = (n: number) => Array.from({ length: Math.max(0, n) }, (_, i) => i + 1);

export function RankingRefEditor({ value, onChange, index, sampleCount }: RefEditorProps) {
  const rank = readRank(value);

  // 新建或剛切換到本題型（value 為空）時，自動寫入預設名次「第 index+1 名」，
  // 讓老師照順序貼範例答案就能直接存檔。只在 value 為空時觸發，寫入後 value 有值就不會再跑，不會 render 迴圈。
  // 其他題型殘留的資料（形狀不同）不覆蓋，改顯示「請選擇」讓老師自己挑。
  useEffect(() => {
    if (value === undefined || value === null) {
      onChange({ rank: index + 1 });
    }
    // onChange 每次 render 都是新函式，不放進 deps 以免重複觸發
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, index]);

  const outOfRange = rank !== null && rank > sampleCount;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`ranking-ref-${index}`} className="text-sm font-medium">
          標準名次
        </label>
        <select
          id={`ranking-ref-${index}`}
          value={rank ?? ''}
          onChange={e => onChange({ rank: Number(e.target.value) })}
          className={SELECT_CLASS}
        >
          {rank === null && <option value="" disabled>請選擇</option>}
          {range(sampleCount).map(n => (
            <option key={n} value={n}>
              第
              {' '}
              {n}
              {' '}
              名
            </option>
          ))}
          {outOfRange && (
            <option value={rank} disabled>
              {`第 ${rank} 名（超出範圍）`}
            </option>
          )}
        </select>
        <span className="text-xs text-muted-foreground">第 1 名＝品質最好</span>
      </div>
      {outOfRange && (
        <p className="text-xs text-red-600">
          {`目前只有 ${sampleCount} 則範例答案，請重新選擇 1–${sampleCount} 的名次`}
        </p>
      )}
    </div>
  );
}

export function RankingReviewPanel({
  sample,
  sampleCount,
  myResponse,
  myComment,
  myResponsesBySample,
  teammates,
  onSubmit,
  submitting,
}: ReviewPanelProps) {
  // 剛送出成功、但 props（myResponse）還沒更新前，用本地快照當作「已送出的值」，避免畫面跳回舊值
  const [lastSaved, setLastSaved] = useState<{ rank: number; comment: string } | null>(null);
  const submittedRank = lastSaved?.rank ?? readRank(myResponse);
  const submittedComment = lastSaved?.comment ?? myComment ?? '';
  // null = 使用者還沒動過，直接沿用已送出的值（伺服器資料晚到也能正確回填）
  const [draftRank, setDraftRank] = useState<number | null>(null);
  const [draftComment, setDraftComment] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rank = draftRank ?? submittedRank;
  const comment = draftComment ?? submittedComment;
  const alreadySubmitted = submittedRank !== null;
  const dirty = rank !== submittedRank || comment.trim() !== submittedComment;

  // 自己其他則已送出、且跟目前選的名次相同的數量
  const duplicateCount = rank === null
    ? 0
    : Object.entries(myResponsesBySample).filter(
      ([sampleId, data]) => Number(sampleId) !== sample.id && readRank(data) === rank,
    ).length;
  const usedByOthers = new Set(
    Object.entries(myResponsesBySample)
      .filter(([sampleId]) => Number(sampleId) !== sample.id)
      .map(([, data]) => readRank(data))
      .filter((r): r is number => r !== null),
  );

  const handleSubmit = async () => {
    if (rank === null) {
      return;
    }
    setError(null);
    const trimmed = comment.trim();
    const result = await onSubmit({ rank }, trimmed || null);
    if (result.ok) {
      setLastSaved({ rank, comment: trimmed });
      setDraftRank(null);
      setDraftComment(null);
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="space-y-3">
      <p className="whitespace-pre-wrap text-sm">{sample.content}</p>

      <div className="space-y-2">
        <p className="text-sm font-medium">
          這則排第幾名？
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {`（共 ${sampleCount} 則，第 1 名＝品質最好）`}
          </span>
        </p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="選擇名次">
          {range(sampleCount).map((n) => {
            const selected = rank === n;
            return (
              <Button
                key={n}
                type="button"
                role="radio"
                aria-checked={selected}
                variant={selected ? 'default' : 'outline'}
                onClick={() => {
                  setDraftRank(n);
                  setError(null);
                }}
                className="relative size-12 text-base font-semibold"
              >
                {n}
                {usedByOthers.has(n) && !selected && (
                  <span
                    className="absolute right-1 top-1 size-1.5 rounded-full bg-amber-500"
                    aria-label="其他則已使用此名次"
                  />
                )}
              </Button>
            );
          })}
        </div>
        {duplicateCount > 0 && rank !== null && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {duplicateCount === 1
              ? `你已經把另一則也排第 ${rank} 名`
              : `你已經把另外 ${duplicateCount} 則也排第 ${rank} 名`}
            ，名次通常不會重複，要再確認一下嗎？
          </p>
        )}
      </div>

      <textarea
        value={comment}
        onChange={(e) => {
          setDraftComment(e.target.value);
          setError(null);
        }}
        rows={2}
        maxLength={COMMENT_MAX}
        placeholder="為什麼排這個名次？（選填，最多 200 字）"
        className={TEXTAREA_CLASS}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button onClick={handleSubmit} disabled={submitting || rank === null || (alreadySubmitted && !dirty)}>
          {alreadySubmitted ? '更新名次' : '送出名次'}
        </Button>
        {error && <span className="text-xs text-red-600">{`送出失敗：${error}`}</span>}
        {!error && alreadySubmitted && !dirty && (
          <span className="text-xs text-emerald-600">已送出</span>
        )}
        {!error && alreadySubmitted && dirty && (
          <span className="text-xs text-amber-600">修改尚未送出</span>
        )}
      </div>

      {teammates.length > 0 && (
        <div className="border-t pt-2 text-xs text-muted-foreground">
          <p className="mb-1">組員名次：</p>
          <ul className="space-y-1">
            {teammates.map((t) => {
              const r = readRank(t.responseData);
              return (
                <li key={t.playerId}>
                  {`${t.nickname}：${r === null ? '尚未排名' : `第 ${r} 名`}`}
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
