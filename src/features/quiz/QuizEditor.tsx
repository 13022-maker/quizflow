'use client';

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { InferSelectModel } from 'drizzle-orm';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  createQuestion,
  deleteQuestion,
  reorderQuestions,
  updateQuestion,
} from '@/actions/questionActions';
import { updateQuiz } from '@/actions/quizActions';
import { Button } from '@/components/ui/button';
import type { questionSchema, quizSchema } from '@/models/Schema';

import { QuestionCard } from './QuestionCard';
import { QuestionForm } from './QuestionForm';
import type { QuestionFormValues } from './QuestionForm';

type Quiz = InferSelectModel<typeof quizSchema>;
type Question = InferSelectModel<typeof questionSchema>;

const STATUS_MAP: Record<Quiz['status'], { label: string; color: string }> = {
  draft: { label: '草稿', color: 'bg-gray-100 text-gray-700' },
  published: { label: '已發佈', color: 'bg-green-100 text-green-700' },
  closed: { label: '已關閉', color: 'bg-red-100 text-red-600' },
};

export function QuizEditor({
  quiz: initialQuiz,
  questions: initialQuestions,
}: {
  quiz: Quiz;
  questions: Question[];
}) {
  const router = useRouter();
  const [questions, setQuestions] = useState(initialQuestions);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 標題 inline 編輯
  const [title, setTitle] = useState(initialQuiz.title);
  const [titleDirty, setTitleDirty] = useState(false);

  // 目前顯示的 status（跟 server 同步後更新）
  const [status, setStatus] = useState(initialQuiz.status);

  // ── DnD ──────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = questions.findIndex(q => q.id === Number(active.id));
    const newIndex = questions.findIndex(q => q.id === Number(over.id));
    const newOrder = arrayMove(questions, oldIndex, newIndex);

    setQuestions(newOrder); // 樂觀更新
    startTransition(async () => {
      await reorderQuestions(initialQuiz.id, newOrder.map(q => q.id));
    });
  };

  // ── 標題儲存 ──────────────────────────────────────────────────────
  const handleSaveTitle = () => {
    if (!titleDirty || !title.trim()) return;
    startTransition(async () => {
      await updateQuiz(initialQuiz.id, { title: title.trim(), status });
      setTitleDirty(false);
    });
  };

  // ── 狀態變更 ──────────────────────────────────────────────────────
  const handleStatusChange = (newStatus: Quiz['status']) => {
    setStatus(newStatus);
    startTransition(async () => {
      await updateQuiz(initialQuiz.id, { title, status: newStatus });
      router.refresh();
    });
  };

  // ── 題目 CRUD ─────────────────────────────────────────────────────
  const handleAddQuestion = async (data: QuestionFormValues) => {
    setIsSubmitting(true);
    await createQuestion(initialQuiz.id, data);
    setIsSubmitting(false);
    setAddingNew(false);
    router.refresh();
  };

  const handleEditQuestion = async (id: number, data: QuestionFormValues) => {
    setIsSubmitting(true);
    await updateQuestion(id, initialQuiz.id, data);
    setIsSubmitting(false);
    setEditingId(null);
    router.refresh();
  };

  const handleDeleteQuestion = (id: number) => {
    setDeletingId(id);
    startTransition(async () => {
      await deleteQuestion(id, initialQuiz.id);
      setQuestions(prev => prev.filter(q => q.id !== id));
      setDeletingId(null);
    });
  };

  const currentStatus = STATUS_MAP[status];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* ── 頂部操作列 ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/dashboard/quizzes"
          className="shrink-0 text-sm text-muted-foreground hover:text-foreground"
        >
          ← 返回
        </Link>

        {/* 可編輯標題 */}
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setTitleDirty(true);
          }}
          onBlur={handleSaveTitle}
          onKeyDown={e => e.key === 'Enter' && (e.currentTarget.blur())}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-xl font-semibold hover:border-input focus:border-input focus:outline-none"
          aria-label="測驗標題"
        />

        {/* 狀態 badge */}
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${currentStatus.color}`}
        >
          {currentStatus.label}
        </span>

        {/* 狀態操作按鈕 */}
        {status === 'draft' && (
          <Button
            size="sm"
            onClick={() => handleStatusChange('published')}
            disabled={isPending}
          >
            發佈測驗
          </Button>
        )}
        {status === 'published' && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleStatusChange('draft')}
              disabled={isPending}
            >
              取消發佈
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleStatusChange('closed')}
              disabled={isPending}
            >
              關閉作答
            </Button>
          </>
        )}
        {status === 'closed' && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleStatusChange('published')}
            disabled={isPending}
          >
            重新開放
          </Button>
        )}
      </div>

      {/* ── 題目清單 ────────────────────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="font-medium">
            題目（
            {questions.length}
            ）
          </h2>
          {questions.length > 1 && (
            <span className="text-xs text-muted-foreground">拖曳左側圓點可排序</span>
          )}
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={questions.map(q => q.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {questions.map((question, index) =>
                editingId === question.id
                  ? (
                      <div key={question.id} className="rounded-lg border bg-card p-4">
                        <p className="mb-3 text-xs font-medium text-muted-foreground">
                          編輯 Q
                          {index + 1}
                        </p>
                        <QuestionForm
                          defaultValues={{
                            type: question.type,
                            body: question.body,
                            options: question.options ?? undefined,
                            correctAnswers: question.correctAnswers ?? undefined,
                            points: question.points,
                          }}
                          onSubmit={data => handleEditQuestion(question.id, data)}
                          onCancel={() => setEditingId(null)}
                          isPending={isSubmitting}
                        />
                      </div>
                    )
                  : (
                      <QuestionCard
                        key={question.id}
                        question={question}
                        index={index}
                        onEdit={() => {
                          setAddingNew(false);
                          setEditingId(question.id);
                        }}
                        onDelete={() => handleDeleteQuestion(question.id)}
                        isDeleting={deletingId === question.id}
                      />
                    ),
              )}
            </div>
          </SortableContext>
        </DndContext>

        {questions.length === 0 && !addingNew && (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            還沒有題目，點選下方按鈕新增第一題
          </div>
        )}
      </div>

      {/* ── 新增題目 ────────────────────────────────────────────── */}
      {addingNew
        ? (
            <QuestionForm
              onSubmit={handleAddQuestion}
              onCancel={() => setAddingNew(false)}
              isPending={isSubmitting}
            />
          )
        : (
            <button
              onClick={() => {
                setEditingId(null);
                setAddingNew(true);
              }}
              className="w-full rounded-lg border border-dashed py-3 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              + 新增題目
            </button>
          )}
    </div>
  );
}
