'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { InferSelectModel } from 'drizzle-orm';
import { useLocale } from 'next-intl';
import { useState, useTransition } from 'react';

import { updateQuestion } from '@/actions/questionActions';
import type { questionSchema } from '@/models/Schema';

import { QUESTION_TYPE_LABELS } from './QuestionForm';

type Question = InferSelectModel<typeof questionSchema>;

type Props = {
  question: Question;
  index: number;
  quizId: number;
  onDelete: () => void;
  isDeleting: boolean;
  isPro: boolean; // 重生題目為 Pro 限定功能
};

/**
 * 選擇題 inline 審題卡片（單選／多選專用）
 * 題目文字、四個選項、正解勾選皆可直接編輯，onBlur 自動儲存
 */
export function InlineQuestionCard({
  question,
  index,
  quizId,
  onDelete,
  isDeleting,
  isPro,
}: Props) {
  const locale = useLocale();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: question.id });

  const style = { transform: CSS.Transform.toString(transform), transition };

  // 本地編輯狀態，避免 server revalidate 在打字途中覆寫
  const [body, setBody] = useState(question.body);
  const [options, setOptions] = useState(question.options ?? []);
  const [correctAnswers, setCorrectAnswers] = useState(
    question.correctAnswers ?? [],
  );
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const isSingle = question.type === 'single_choice';

  // 呼叫 updateQuestion，overrides 允許傳入最新值（避免 setState 非同步）
  const save = (overrides?: {
    body?: string;
    options?: { id: string; text: string }[];
    correctAnswers?: string[];
  }) => {
    setSaveState('saving');
    startTransition(async () => {
      const result = await updateQuestion(question.id, quizId, {
        type: question.type,
        body: overrides?.body ?? body,
        imageUrl: question.imageUrl ?? '',
        audioUrl: question.audioUrl ?? '',
        audioTranscript: question.audioTranscript ?? '',
        options: overrides?.options ?? options,
        correctAnswers: overrides?.correctAnswers ?? correctAnswers,
        points: question.points,
      });
      if (result?.error) {
        setSaveState('error');
        return;
      }
      setSaveState('saved');
      // 1.5 秒後清掉「已儲存」提示
      setTimeout(() => setSaveState('idle'), 1500);
    });
  };

  // 選項文字變更
  const updateOptionText = (optId: string, text: string) => {
    setOptions(prev => prev.map(o => (o.id === optId ? { ...o, text } : o)));
  };

  // 重新生成此題：呼叫 /api/ai/regenerate-question/[id]，成功後更新本地狀態
  const handleRegenerate = async () => {
    // 非 Pro 方案直接導到 billing 頁升級
    if (!isPro) {
      window.location.href = '/dashboard/billing';
      return;
    }
    // 先跟老師確認，避免誤點（無法復原）
    // eslint-disable-next-line no-alert
    if (!window.confirm('重新生成會取代目前題目與選項，確定要重生嗎？')) {
      return;
    }
    setIsRegenerating(true);
    setRegenerateError(null);
    try {
      const res = await fetch(`/api/ai/regenerate-question/${question.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRegenerateError(data.error ?? '重生失敗，請稍後再試');
        return;
      }
      // 用 API 回傳的新題目覆蓋本地 state
      setBody(data.question.body);
      setOptions(data.question.options);
      setCorrectAnswers(data.question.correctAnswers);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知錯誤';
      setRegenerateError(`重生失敗：${msg}`);
    } finally {
      setIsRegenerating(false);
    }
  };

  // 切換正解
  const toggleCorrect = (optId: string) => {
    const next = isSingle
      ? [optId] // 單選：永遠只有一個
      : correctAnswers.includes(optId)
        ? correctAnswers.filter(id => id !== optId)
        : [...correctAnswers, optId];
    setCorrectAnswers(next);
    save({ correctAnswers: next });
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-start gap-3 rounded-lg border bg-card p-4 transition-shadow ${
        isDragging ? 'opacity-50 shadow-lg' : ''
      }`}
    >
      {/* 拖曳把手 */}
      <button
        {...attributes}
        {...listeners}
        className="mt-0.5 cursor-grab text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
        aria-label="拖曳排序"
      >
        <svg viewBox="0 0 20 20" width="16" fill="currentColor">
          <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z" />
        </svg>
      </button>

      {/* 內容 */}
      <div className="min-w-0 flex-1">
        {/* Header：題號 + 題型 + 分數 + 儲存狀態 */}
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Q
            {index + 1}
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
            {QUESTION_TYPE_LABELS[question.type]}
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
            {question.points}
            {' '}
            分
          </span>
          {saveState === 'saving' && (
            <span className="text-xs text-muted-foreground">儲存中…</span>
          )}
          {saveState === 'saved' && (
            <span className="text-xs text-green-600">✓ 已儲存</span>
          )}
          {saveState === 'error' && (
            <span className="text-xs text-red-600">儲存失敗，請重試</span>
          )}
          {isRegenerating && (
            <span className="text-xs text-amber-600">✨ 重生中…</span>
          )}
          {regenerateError && (
            <span className="text-xs text-red-600">{regenerateError}</span>
          )}
        </div>

        {/* 題目文字：textarea，onBlur 自動儲存 */}
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          onBlur={() => {
            if (body !== question.body) {
              save();
            }
          }}
          rows={2}
          className="w-full resize-y rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm hover:border-input focus:border-input focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="題目內容"
        />

        {/* 選項清單：每行 [checkbox/radio] + [inline text input] */}
        <div className="mt-2 space-y-1.5">
          {options.map(opt => (
            // eslint-disable-next-line jsx-a11y/label-has-associated-control
            <label
              key={opt.id}
              className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted/40"
            >
              <input
                type={isSingle ? 'radio' : 'checkbox'}
                name={`correct-${question.id}`}
                checked={correctAnswers.includes(opt.id)}
                onChange={() => toggleCorrect(opt.id)}
                className="size-4 shrink-0 cursor-pointer accent-green-600"
                aria-label="標記為正確答案"
              />
              <input
                type="text"
                value={opt.text}
                onChange={e => updateOptionText(opt.id, e.target.value)}
                onBlur={() => save()}
                className="flex-1 rounded-sm border border-transparent bg-transparent px-2 py-0.5 text-sm hover:border-input focus:border-input focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="選項內容"
              />
            </label>
          ))}
        </div>
      </div>

      {/* 操作按鈕：重生 + 刪除 */}
      <div className="flex shrink-0 gap-1">
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={isRegenerating || isDeleting}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-amber-600 disabled:opacity-50"
          aria-label="重新生成此題"
          title={isPro ? '重新生成此題' : '升級 Pro 解鎖重生題目'}
        >
          {isRegenerating ? '…' : isPro ? '🔄' : '🔒'}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={isDeleting || isRegenerating}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
          aria-label="刪除此題"
          title="刪除此題"
        >
          {isDeleting ? '…' : '🗑️'}
        </button>
      </div>
    </div>
  );
}
