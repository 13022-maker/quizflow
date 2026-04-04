'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { InferSelectModel } from 'drizzle-orm';

import type { questionSchema } from '@/models/Schema';

import { QUESTION_TYPE_LABELS } from './QuestionForm';

type Question = InferSelectModel<typeof questionSchema>;

type Props = {
  question: Question;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
};

export function QuestionCard({ question, index, onEdit, onDelete, isDeleting }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: question.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
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

      {/* 題號 + 內容 */}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
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
        </div>
        <p className="line-clamp-2 text-sm">{question.body}</p>
        {question.options && question.options.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {question.options.length}
            {' '}
            個選項
            {question.correctAnswers && question.correctAnswers.length > 0 && (
              <span className="ml-1 text-green-600">
                ·
                {' '}
                {question.correctAnswers.length}
                {' '}
                個正確答案
              </span>
            )}
          </p>
        )}
      </div>

      {/* 操作 */}
      <div className="flex shrink-0 gap-1">
        <button
          onClick={onEdit}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          編輯
        </button>
        <button
          onClick={onDelete}
          disabled={isDeleting}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
        >
          {isDeleting ? '…' : '刪除'}
        </button>
      </div>
    </div>
  );
}
