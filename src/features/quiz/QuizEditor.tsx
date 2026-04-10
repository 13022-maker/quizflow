'use client';

import type { DragEndEvent } from '@dnd-kit/core';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
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
import { updateQuiz, updateQuizSettings } from '@/actions/quizActions';
import AIQuizModal from '@/components/quiz/AIQuizModal';
import FileQuizGenerator from '@/components/quiz/FileQuizGenerator';
import QRCodeModal from '@/components/quiz/QRCodeModal';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { questionSchema, quizSchema } from '@/models/Schema';

import { QuestionCard } from './QuestionCard';
import type { QuestionFormValues } from './QuestionForm';
import { QuestionForm } from './QuestionForm';

// FileQuizGenerator 回傳的題目格式
type FileQuestionType = 'mc' | 'tf' | 'fill' | 'short';
type FileGeneratedQuestion = {
  type: FileQuestionType;
  question: string;
  options?: string[];
  answer: string;
  explanation?: string;
};

// 題型對應：FileQuizGenerator → DB enum
const FILE_TYPE_MAP: Record<FileQuestionType, 'single_choice' | 'true_false' | 'short_answer'> = {
  mc: 'single_choice',
  tf: 'true_false',
  fill: 'short_answer',
  short: 'short_answer',
};

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
  isPro,
}: {
  quiz: Quiz;
  questions: Question[];
  isPro: boolean;
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

  // 隨機排序設定
  const [shuffleQuestions, setShuffleQuestions] = useState(initialQuiz.shuffleQuestions);
  const [shuffleOptions, setShuffleOptions] = useState(initialQuiz.shuffleOptions);

  // 防作弊設定
  const [allowedAttempts, setAllowedAttempts] = useState<string>(
    initialQuiz.allowedAttempts?.toString() ?? 'unlimited',
  );
  const [showAnswers, setShowAnswers] = useState(initialQuiz.showAnswers);
  const [timeLimit, setTimeLimit] = useState<string>(
    initialQuiz.timeLimitSeconds?.toString() ?? 'unlimited',
  );
  const [customTime, setCustomTime] = useState<string>(
    initialQuiz.timeLimitSeconds
    && ![600, 1200, 1800, 3600].includes(initialQuiz.timeLimitSeconds)
      ? String(Math.round(initialQuiz.timeLimitSeconds / 60))
      : '',
  );

  // ── DnD ──────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

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
    if (!titleDirty || !title.trim()) {
      return;
    }
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

  // ── 隨機排序設定 ──────────────────────────────────────────────────
  const handleToggleShuffle = (field: 'shuffleQuestions' | 'shuffleOptions', value: boolean) => {
    if (field === 'shuffleQuestions') {
      setShuffleQuestions(value);
    } else {
      setShuffleOptions(value);
    }
    startTransition(async () => {
      await updateQuizSettings(initialQuiz.id, { [field]: value });
    });
  };

  // ── 防作弊設定 ────────────────────────────────────────────────────
  const handleAllowedAttemptsChange = (value: string) => {
    setAllowedAttempts(value);
    const parsed = value === 'unlimited' ? null : Number(value);
    startTransition(async () => {
      await updateQuizSettings(initialQuiz.id, { allowedAttempts: parsed });
    });
  };

  const handleShowAnswersChange = (value: boolean) => {
    setShowAnswers(value);
    startTransition(async () => {
      await updateQuizSettings(initialQuiz.id, { showAnswers: value });
    });
  };

  const handleTimeLimitChange = (value: string) => {
    setTimeLimit(value);
    if (value === 'custom') {
      return;
    } // 等使用者輸入自訂分鐘數
    const seconds = value === 'unlimited' ? null : Number(value);
    startTransition(async () => {
      await updateQuizSettings(initialQuiz.id, { timeLimitSeconds: seconds });
    });
  };

  const handleCustomTimeBlur = () => {
    const mins = Number.parseInt(customTime, 10);
    if (!mins || mins <= 0) {
      return;
    }
    startTransition(async () => {
      await updateQuizSettings(initialQuiz.id, { timeLimitSeconds: mins * 60 });
    });
  };

  // 控制 QR Code Modal 顯示
  const [showQRModal, setShowQRModal] = useState(false);

  // 控制 AIQuizModal 顯示
  const [showAIModal, setShowAIModal] = useState(false);

  // ── AIQuizModal onImport：批次 POST 到 /api/quizzes/[id]/questions ─────
  const handleAIImport = async (questions: FileGeneratedQuestion[], _title: string) => {
    setIsSubmitting(true);
    setShowAIModal(false);

    await fetch(`/api/quizzes/${initialQuiz.id}/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions }),
    });

    setIsSubmitting(false);
    router.refresh();
  };

  // 控制「上傳講義命題」Modal 顯示
  const [showFileGenerator, setShowFileGenerator] = useState(false);

  // ── 從檔案匯入題目 ──────────────────────────────────────────────────
  const handleFileImport = async (questions: FileGeneratedQuestion[], _title: string) => {
    setIsSubmitting(true);
    setShowFileGenerator(false);

    for (const q of questions) {
      const type = FILE_TYPE_MAP[q.type];

      if (q.type === 'mc' && q.options?.length) {
        // 選擇題：將 string[] 轉換為 { id, text }[]，並找出正確答案的 id
        const options = q.options.map((text, i) => ({
          id: String.fromCharCode(97 + i), // a, b, c, d
          text,
        }));
        const correctOpt = options.find(o => o.text === q.answer);
        await createQuestion(initialQuiz.id, {
          type,
          body: q.question,
          options,
          correctAnswers: correctOpt ? [correctOpt.id] : [],
          points: 1,
        });
      } else {
        // 是非題 / 填空題 / 簡答題：直接存 answer 字串
        await createQuestion(initialQuiz.id, {
          type,
          body: q.question,
          correctAnswers: q.answer ? [q.answer] : [],
          points: 1,
        });
      }
    }

    setIsSubmitting(false);
    router.refresh();
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

        {/* QR Code 按鈕：僅在有 accessCode 時顯示 */}
        {initialQuiz.accessCode && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowQRModal(true)}
            className="gap-1.5"
          >
            📱 QR Code
          </Button>
        )}

        {/* AI 出題按鈕：開啟 AIQuizModal，Pro 限定 */}
        {isPro
          ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowAIModal(true)}
                disabled={isSubmitting}
                className="gap-1.5"
              >
                ✨ AI 出題
              </Button>
            )
          : (
              <div className="relative">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => {
                    window.location.href = '/dashboard/billing';
                  }}
                >
                  ✨ AI 出題
                </Button>
              </div>
            )}

        {/* 上傳講義命題按鈕（Pro 限定） */}
        {isPro
          ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowFileGenerator(true)}
                disabled={isSubmitting}
              >
                📂 上傳講義命題
              </Button>
            )
          : (
              <Button size="sm" variant="outline" disabled title="此功能僅限 Pro 方案">
                📂 上傳講義命題
              </Button>
            )}
      </div>

      {/* QR Code Modal */}
      {showQRModal && initialQuiz.accessCode && (
        <QRCodeModal
          quizTitle={initialQuiz.title}
          accessCode={initialQuiz.accessCode}
          onClose={() => setShowQRModal(false)}
        />
      )}

      {/* AI 出題 Modal */}
      {showAIModal && (
        <AIQuizModal
          onImport={handleAIImport}
          onClose={() => setShowAIModal(false)}
        />
      )}

      {/* 上傳講義命題 Modal */}
      {showFileGenerator && (
        <FileQuizGenerator
          onImport={handleFileImport}
          onClose={() => setShowFileGenerator(false)}
        />
      )}

      {/* ── 測驗設定 ─────────────────────────────────────────────── */}
      <div className="space-y-4 rounded-lg border bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">測驗設定</p>

        {/* 第一列：兩個 toggle */}
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Switch
              checked={shuffleQuestions}
              onCheckedChange={val => handleToggleShuffle('shuffleQuestions', val)}
              disabled={isPending}
            />
            題目隨機排序
          </label>
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Switch
              checked={shuffleOptions}
              onCheckedChange={val => handleToggleShuffle('shuffleOptions', val)}
              disabled={isPending}
            />
            選項隨機排序
          </label>
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Switch
              checked={showAnswers}
              onCheckedChange={handleShowAnswersChange}
              disabled={isPending}
            />
            交卷後顯示解答
          </label>
        </div>

        {/* 第二列：兩個 select */}
        <div className="flex flex-wrap gap-4">
          {/* 作答次數 */}
          <div className="flex items-center gap-2 text-sm">
            <span className="shrink-0 text-muted-foreground">作答次數上限</span>
            <select
              value={allowedAttempts}
              onChange={e => handleAllowedAttemptsChange(e.target.value)}
              disabled={isPending}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="unlimited">無限制</option>
              <option value="1">只能作答 1 次</option>
              <option value="3">只能作答 3 次</option>
            </select>
          </div>

          {/* 限時作答 */}
          <div className="flex items-center gap-2 text-sm">
            <span className="shrink-0 text-muted-foreground">限時作答</span>
            <select
              value={timeLimit}
              onChange={e => handleTimeLimitChange(e.target.value)}
              disabled={isPending}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="unlimited">無限制</option>
              <option value="600">10 分鐘</option>
              <option value="1200">20 分鐘</option>
              <option value="1800">30 分鐘</option>
              <option value="3600">60 分鐘</option>
              <option value="custom">自訂</option>
            </select>
            {timeLimit === 'custom' && (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  value={customTime}
                  onChange={e => setCustomTime(e.target.value)}
                  onBlur={handleCustomTimeBlur}
                  placeholder="分鐘"
                  className="w-16 rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <span className="text-muted-foreground">分鐘</span>
              </div>
            )}
          </div>
        </div>
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
                            imageUrl: question.imageUrl ?? '',
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
