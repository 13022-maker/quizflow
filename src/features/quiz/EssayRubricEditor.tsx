'use client';

// 申論題批改評分量表（rubric）的可收合編輯器
// 顯示在 short_answer 類型的 QuestionCard 底下；null = 沿用系統預設 4 面向
import { useState, useTransition } from 'react';

import { updateQuestionRubric } from '@/actions/questionActions';
import { Button } from '@/components/ui/button';
import { DEFAULT_ESSAY_RUBRIC, type EssayRubric } from '@/lib/ai/prompts';

type Props = {
  questionId: number;
  quizId: number;
  initialRubric: EssayRubric | null;
};

export function EssayRubricEditor({ questionId, quizId, initialRubric }: Props) {
  const [open, setOpen] = useState(false);
  const [rubric, setRubric] = useState<EssayRubric>(
    initialRubric ?? DEFAULT_ESSAY_RUBRIC,
  );
  const [isPending, startTransition] = useTransition();
  const [savedMsg, setSavedMsg] = useState('');
  const [error, setError] = useState('');

  const isCustom = initialRubric !== null;

  const handleChangeCriterion = (
    i: number,
    field: 'name' | 'maxScore' | 'description',
    value: string,
  ) => {
    setRubric(prev => ({
      ...prev,
      criteria: prev.criteria.map((c, idx) =>
        idx === i
          ? {
              ...c,
              [field]: field === 'maxScore' ? Math.max(1, Number(value) || 1) : value,
            }
          : c,
      ),
    }));
  };

  const handleAdd = () => {
    setRubric(prev => ({
      ...prev,
      criteria: [
        ...prev.criteria,
        { name: '', maxScore: 5, description: '' },
      ],
    }));
  };

  const handleRemove = (i: number) => {
    setRubric(prev => ({
      ...prev,
      criteria: prev.criteria.filter((_, idx) => idx !== i),
    }));
  };

  const handleReset = () => {
    setRubric(DEFAULT_ESSAY_RUBRIC);
  };

  const handleSave = () => {
    setError('');
    setSavedMsg('');
    startTransition(async () => {
      const res = await updateQuestionRubric(questionId, quizId, rubric);
      if (res && 'error' in res) {
        setError(res.error);
        return;
      }
      setSavedMsg('已儲存');
      setTimeout(() => setSavedMsg(''), 2500);
    });
  };

  const handleUseDefault = () => {
    setError('');
    setSavedMsg('');
    startTransition(async () => {
      await updateQuestionRubric(questionId, quizId, null);
      setRubric(DEFAULT_ESSAY_RUBRIC);
      setSavedMsg('已恢復為系統預設');
      setTimeout(() => setSavedMsg(''), 2500);
    });
  };

  const totalMax = rubric.criteria.reduce((sum, c) => sum + c.maxScore, 0);

  return (
    <div className="mt-3 rounded-lg border border-dashed bg-muted/30 p-3">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between text-left text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <span className="inline-flex items-center gap-1.5">
          ✏️ 批改評分量表
          {isCustom
            ? (
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                  自訂
                </span>
              )
            : (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
                  預設四面向 · 滿分 20
                </span>
              )}
        </span>
        <span className={`transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            AI 會依以下面向批改學生作文，滿分加總
            {' '}
            <strong>{totalMax}</strong>
            {' '}
            分，實得分會按比例換算到本題配分
          </p>

          <div className="space-y-2">
            {rubric.criteria.map((c, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <div key={i} className="flex flex-col gap-2 rounded border bg-background p-2 sm:flex-row sm:items-start">
                <input
                  type="text"
                  value={c.name}
                  onChange={e => handleChangeCriterion(i, 'name', e.target.value)}
                  placeholder="面向名稱"
                  className="rounded-md border border-input bg-transparent px-2 py-1 text-sm sm:w-24"
                />
                <input
                  type="number"
                  value={c.maxScore}
                  min={1}
                  onChange={e => handleChangeCriterion(i, 'maxScore', e.target.value)}
                  className="rounded-md border border-input bg-transparent px-2 py-1 text-sm sm:w-16"
                  aria-label="滿分"
                />
                <textarea
                  value={c.description}
                  onChange={e => handleChangeCriterion(i, 'description', e.target.value)}
                  placeholder="評分依據（例如：論點清晰、舉例恰當）"
                  rows={1}
                  className="flex-1 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                />
                <button
                  type="button"
                  onClick={() => handleRemove(i)}
                  disabled={rubric.criteria.length <= 1}
                  className="rounded p-1 text-xs text-muted-foreground hover:text-destructive disabled:opacity-30"
                  aria-label="刪除此面向"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div>
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
            <label className="mb-1 block text-xs text-muted-foreground">額外批改指示（選填）</label>
            <textarea
              value={rubric.instructions ?? ''}
              onChange={e => setRubric(prev => ({ ...prev, instructions: e.target.value }))}
              placeholder="例如：嚴格檢查錯別字；鼓勵使用成語"
              rows={2}
              className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={isPending}
            >
              {isPending ? '儲存中…' : '儲存量表'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleAdd}
              disabled={isPending || rubric.criteria.length >= 8}
            >
              + 加面向
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleReset}
              disabled={isPending}
            >
              重設為預設
            </Button>
            {isCustom && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handleUseDefault}
                disabled={isPending}
                className="text-muted-foreground"
              >
                使用系統預設
              </Button>
            )}
            {savedMsg && <span className="text-xs font-medium text-green-600">{savedMsg}</span>}
            {error && <span className="text-xs font-medium text-destructive">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
