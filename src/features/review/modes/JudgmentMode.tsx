'use client';

// 對錯判斷 + 錯因 題型的前端元件
// - JudgmentRefEditor：老師設定「這則答案對/錯」＋錯因選項＋正確錯因
// - JudgmentReviewPanel：學生判斷對/錯，判錯時選錯因，可留短評
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  JUDGMENT_MAX_REASONS,
  JUDGMENT_MIN_REASONS,
  JUDGMENT_REASON_MAX_LENGTH,
} from '@/services/review/modes/judgment';

import type { RefEditorProps, ReviewPanelProps } from './types';

const TEXTAREA_CLASS = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

type RefDraft = { isCorrect: boolean; reasonOptions: string[]; correctReasonIndex: number | null };
type ResponseDraft = { isCorrect: boolean; reasonIndex: number | null };

// 新建或剛切換題型時 value 是 undefined：畫面先顯示預設值，使用者第一次操作才寫入（不在 render 時 onChange，避免迴圈）。
// 未操作就送出時 server 端 refSchema 會擋下並提示「請設定這則答案的對錯與錯因選項」。
const DEFAULT_REF: RefDraft = { isCorrect: false, reasonOptions: ['', ''], correctReasonIndex: null };

function toRefDraft(value: unknown): RefDraft {
  if (!value || typeof value !== 'object') {
    return DEFAULT_REF;
  }
  const v = value as Partial<RefDraft>;
  const reasonOptions = Array.isArray(v.reasonOptions)
    ? v.reasonOptions.filter((o): o is string => typeof o === 'string').slice(0, JUDGMENT_MAX_REASONS)
    : [];
  while (reasonOptions.length < JUDGMENT_MIN_REASONS) {
    reasonOptions.push('');
  }
  const isCorrect = v.isCorrect === true;
  const idx = v.correctReasonIndex;
  const correctReasonIndex = !isCorrect && typeof idx === 'number' && idx >= 0 && idx < reasonOptions.length ? idx : null;
  return { isCorrect, reasonOptions, correctReasonIndex };
}

function toResponse(value: unknown): ResponseDraft | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const v = value as Partial<ResponseDraft>;
  if (typeof v.isCorrect !== 'boolean') {
    return null;
  }
  return { isCorrect: v.isCorrect, reasonIndex: typeof v.reasonIndex === 'number' ? v.reasonIndex : null };
}

function toReasonOptions(clientData: unknown): string[] {
  if (!clientData || typeof clientData !== 'object') {
    return [];
  }
  const opts = (clientData as { reasonOptions?: unknown }).reasonOptions;
  return Array.isArray(opts) ? opts.filter((o): o is string => typeof o === 'string') : [];
}

export function JudgmentRefEditor({ value, onChange, index }: RefEditorProps) {
  const ref = toRefDraft(value);
  const radioName = `judgment-ref-${index}`;

  const emit = (patch: Partial<RefDraft>) => {
    const next = { ...ref, ...patch };
    onChange({ ...next, correctReasonIndex: next.isCorrect ? null : next.correctReasonIndex });
  };

  const updateOption = (i: number, text: string) => {
    emit({ reasonOptions: ref.reasonOptions.map((o, idx) => (idx === i ? text : o)) });
  };

  const removeOption = (i: number) => {
    const reasonOptions = ref.reasonOptions.filter((_, idx) => idx !== i);
    let correctReasonIndex = ref.correctReasonIndex;
    if (correctReasonIndex === i) {
      correctReasonIndex = null;
    } else if (correctReasonIndex !== null && correctReasonIndex > i) {
      correctReasonIndex -= 1;
    }
    emit({ reasonOptions, correctReasonIndex });
  };

  return (
    <div className="space-y-3 rounded-md bg-muted/40 p-3">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="font-medium">這則答案是：</span>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name={`${radioName}-verdict`}
            checked={ref.isCorrect}
            onChange={() => emit({ isCorrect: true })}
          />
          ✅ 對
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name={`${radioName}-verdict`}
            checked={!ref.isCorrect}
            onChange={() => emit({ isCorrect: false })}
          />
          ❌ 錯
        </label>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          錯因選項（
          {JUDGMENT_MIN_REASONS}
          –
          {JUDGMENT_MAX_REASONS}
          {' '}
          個，每個最多
          {' '}
          {JUDGMENT_REASON_MAX_LENGTH}
          {' '}
          字）
          {ref.isCorrect
            ? '：這則是對的，選項會當作誘答，學生端看到的畫面跟錯的答案一樣'
            : '：請點選左邊圓圈指定「真正的錯因」'}
        </p>
        {ref.reasonOptions.map((opt, i) => (
          // 選項沒有穩定 id，用索引當 key；刪除時整列重排可接受
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} className="flex items-center gap-2">
            {!ref.isCorrect && (
              <input
                type="radio"
                name={`${radioName}-reason`}
                aria-label={`指定第 ${i + 1} 個為正確錯因`}
                checked={ref.correctReasonIndex === i}
                onChange={() => emit({ correctReasonIndex: i })}
                className="size-4 shrink-0"
              />
            )}
            <Input
              value={opt}
              maxLength={JUDGMENT_REASON_MAX_LENGTH}
              onChange={e => updateOption(i, e.target.value)}
              placeholder={['例如：單位換算錯', '例如：漏看條件', '例如：計算錯誤', '例如：概念誤解'][i]}
            />
            {ref.reasonOptions.length > JUDGMENT_MIN_REASONS && (
              <Button type="button" variant="ghost" size="sm" onClick={() => removeOption(i)}>
                刪除
              </Button>
            )}
          </div>
        ))}
        {ref.reasonOptions.length < JUDGMENT_MAX_REASONS && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => emit({ reasonOptions: [...ref.reasonOptions, ''] })}
          >
            ＋ 新增錯因選項
          </Button>
        )}
      </div>
    </div>
  );
}

export function JudgmentReviewPanel({
  sample,
  myResponse,
  myComment,
  teammates,
  onSubmit,
  submitting,
}: ReviewPanelProps) {
  const reasonOptions = toReasonOptions(sample.clientData);
  const initial = toResponse(myResponse);

  // 草稿：使用者動過才有值；沒動過就顯示已送出的作答（myResponse 可能在 polling 後才到，不能只在 mount 時讀一次）
  const [draft, setDraft] = useState<{ isCorrect: boolean | null; reasonIndex: number | null } | null>(null);
  const [commentDraft, setCommentDraft] = useState<string | null>(null);
  const [savedOnce, setSavedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCorrect = draft ? draft.isCorrect : (initial?.isCorrect ?? null);
  const reasonIndex = draft ? draft.reasonIndex : (initial?.reasonIndex ?? null);
  const comment = commentDraft ?? myComment ?? '';
  const setComment = (text: string) => setCommentDraft(text);
  const setReasonIndex = (i: number) => setDraft({ isCorrect: false, reasonIndex: i });

  const alreadySaved = initial !== null || savedOnce;
  const canSubmit = isCorrect === true || (isCorrect === false && reasonIndex !== null);

  const pick = (verdict: boolean) => {
    setError(null);
    // 判對清掉錯因；從「對」切到「錯」也清空，讓學生重新選
    setDraft({ isCorrect: verdict, reasonIndex: verdict || isCorrect !== false ? null : reasonIndex });
  };

  const handleSubmit = async () => {
    if (!canSubmit) {
      return;
    }
    setError(null);
    const result = await onSubmit(
      { isCorrect, reasonIndex: isCorrect ? null : reasonIndex },
      comment.trim() || null,
    );
    if (result.ok) {
      setSavedOnce(true);
    } else {
      setError(result.error);
    }
  };

  const verdictClass = (active: boolean, tone: 'ok' | 'bad') =>
    `flex min-h-14 items-center justify-center rounded-lg border-2 text-base font-semibold transition-colors ${
      active
        ? tone === 'ok'
          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
          : 'border-rose-500 bg-rose-50 text-rose-700'
        : 'border-input bg-background hover:bg-accent'
    }`;

  const describe = (res: ResponseDraft | null) => {
    if (!res) {
      return '尚未判斷';
    }
    if (res.isCorrect) {
      return '判對';
    }
    const reason = res.reasonIndex !== null ? reasonOptions[res.reasonIndex] : undefined;
    return reason ? `判錯（${reason}）` : '判錯';
  };

  return (
    <div className="space-y-3">
      <p className="whitespace-pre-wrap text-sm">{sample.content}</p>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          aria-pressed={isCorrect === true}
          onClick={() => pick(true)}
          className={verdictClass(isCorrect === true, 'ok')}
        >
          ✅ 正確
        </button>
        <button
          type="button"
          aria-pressed={isCorrect === false}
          onClick={() => pick(false)}
          className={verdictClass(isCorrect === false, 'bad')}
        >
          ❌ 有錯
        </button>
      </div>

      {isCorrect === false && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">錯在哪裡？</legend>
          {reasonOptions.map((opt, i) => (
            <label
              // 選項內容可能重複前綴，用索引確保唯一
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 text-sm ${
                reasonIndex === i ? 'border-rose-500 bg-rose-50' : 'border-input'
              }`}
            >
              <input
                type="radio"
                name={`judgment-reason-${sample.id}`}
                checked={reasonIndex === i}
                onChange={() => {
                  setReasonIndex(i);
                  setError(null);
                }}
                className="size-4"
              />
              {opt}
            </label>
          ))}
        </fieldset>
      )}

      <textarea
        value={comment}
        onChange={e => setComment(e.target.value)}
        rows={2}
        maxLength={200}
        placeholder="短評（選填，最多 200 字）"
        className={TEXTAREA_CLASS}
      />

      <div className="flex items-center justify-between gap-3">
        <Button onClick={handleSubmit} disabled={submitting || !canSubmit}>
          {alreadySaved ? '更新判斷' : '送出判斷'}
        </Button>
        {error
          ? <span className="text-xs text-destructive">{error}</span>
          : alreadySaved && <span className="text-xs text-emerald-600">已送出</span>}
      </div>
      {isCorrect === false && reasonIndex === null && (
        <p className="text-xs text-muted-foreground">請先選一個錯因再送出</p>
      )}

      {teammates.length > 0 && (
        <div className="border-t pt-2 text-xs text-muted-foreground">
          <p className="mb-1">組員判斷：</p>
          <ul className="space-y-1">
            {teammates.map(t => (
              <li key={t.playerId}>
                {t.nickname}
                ：
                {describe(toResponse(t.responseData))}
                {t.comment && ` — ${t.comment}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
