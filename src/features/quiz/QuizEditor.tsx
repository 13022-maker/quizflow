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
import { useEffect, useState, useTransition } from 'react';

import {
  createQuestion,
  deleteQuestion,
  distributePoints,
  reorderQuestions,
  updateQuestion,
} from '@/actions/questionActions';
import { updateQuiz, updateQuizSettings } from '@/actions/quizActions';
import AIQuizModal from '@/components/quiz/AIQuizModal';
import FileQuizGenerator from '@/components/quiz/FileQuizGenerator';
import ShareModal from '@/components/quiz/ShareModal';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { questionSchema, quizSchema } from '@/models/Schema';

import { QuestionCard } from './QuestionCard';
import type { QuestionFormValues } from './QuestionForm';
import { QuestionForm } from './QuestionForm';

// FileQuizGenerator 回傳的題目格式（純文字 answer，不含 rank）
type FileQuestionType = 'mc' | 'tf' | 'fill' | 'short';
type FileGeneratedQuestion = {
  type: FileQuestionType;
  question: string;
  options?: string[];
  answer: string;
  explanation?: string;
};

// AIQuizModal 回傳的題目格式（支援 rank，answer 可能為陣列）
type AIQuestionType = 'mc' | 'tf' | 'fill' | 'short' | 'rank' | 'listening';
type AIGeneratedQuestion = {
  type: AIQuestionType;
  question: string;
  options?: string[];
  answer: string | string[];
  explanation?: string;
  listeningText?: string; // 聽力題口語化文字
  audioUrl?: string; // 聽力題 TTS 音檔 URL
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

const STUDENT_FACING_PHRASES = [
  '完成後可查看解答與詳解',
  '完成後可查看解答',
  '可查看解答與詳解',
];

function buildDefaultTopic(description?: string | null): string {
  if (!description) return '';
  let desc = description;
  for (const phrase of STUDENT_FACING_PHRASES) {
    desc = desc.replace(phrase, '');
  }
  desc = desc.trim();
  if (!desc) return '';
  return desc;
}

// 狀態樣式：小色點 + 文字（與 Dashboard 一致）
const STATUS_MAP: Record<Quiz['status'], { label: string; dot: string }> = {
  draft: { label: '草稿', dot: 'bg-muted-foreground/60' },
  published: { label: '已發佈', dot: 'bg-primary' },
  closed: { label: '已關閉', dot: 'bg-destructive' },
};

export function QuizEditor({
  quiz: initialQuiz,
  questions: initialQuestions,
  isPro,
  autoOpenAI = false,
}: {
  quiz: Quiz;
  questions: Question[];
  isPro: boolean;
  autoOpenAI?: boolean;
}) {
  const router = useRouter();
  const [questions, setQuestions] = useState(initialQuestions);

  // 同步 initialQuestions prop → local state
  // 原因：router.refresh() 會讓 server component 重新傳入新的 initialQuestions，
  // 但 useState(initialQuestions) 只在第一次 render 讀取 prop，後續不會自動更新。
  // 沒有這個 sync，AI 匯入、新增題目、編輯題目、講義匯入後畫面都不會即時更新
  // （要手動 F5 才看得到）。
  useEffect(() => {
    setQuestions(initialQuestions);
  }, [initialQuestions]);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);

  // 平均配分成功提示
  const [distributeMsg, setDistributeMsg] = useState('');

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
  const [preventLeave, setPreventLeave] = useState(initialQuiz.preventLeave);

  // 目前選中的快速方案（null = 未選或手動調整後取消）
  type ModePreset = 'exam' | 'practice' | 'review';
  const [activePreset, setActivePreset] = useState<ModePreset | null>(null);
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
    // 手動改 Toggle 後取消方案選中
    setActivePreset(null);
    startTransition(async () => {
      await updateQuizSettings(initialQuiz.id, { [field]: value });
    });
  };

  // ── 防離頁保護 ────────────────────────────────────────────────────
  const handlePreventLeaveChange = (value: boolean) => {
    setPreventLeave(value);
    setActivePreset(null);
    startTransition(async () => {
      await updateQuizSettings(initialQuiz.id, { preventLeave: value });
    });
  };

  // ── 快速套用方案 ──────────────────────────────────────────────────
  // 對照：考試(隨題✅/隨選✅/顯解❌/防離✅)
  //      練習(隨題❌/隨選❌/顯解✅/防離❌)
  //      複習(隨題✅/隨選✅/顯解✅/防離❌)
  const applyPreset = (preset: ModePreset) => {
    const presets: Record<ModePreset, {
      shuffleQuestions: boolean;
      shuffleOptions: boolean;
      showAnswers: boolean;
      preventLeave: boolean;
    }> = {
      exam: { shuffleQuestions: true, shuffleOptions: true, showAnswers: false, preventLeave: true },
      practice: { shuffleQuestions: false, shuffleOptions: false, showAnswers: true, preventLeave: false },
      review: { shuffleQuestions: true, shuffleOptions: true, showAnswers: true, preventLeave: false },
    };
    const config = presets[preset];

    // 同步更新 UI 狀態
    setShuffleQuestions(config.shuffleQuestions);
    setShuffleOptions(config.shuffleOptions);
    setShowAnswers(config.showAnswers);
    setPreventLeave(config.preventLeave);
    setActivePreset(preset);

    // 一次送出整組設定到 server
    startTransition(async () => {
      await updateQuizSettings(initialQuiz.id, config);
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
    setActivePreset(null);
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

  // 設定區預設收起
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 控制 QR Code Modal 顯示
  const [showQRModal, setShowQRModal] = useState(false);

  // 控制 AIQuizModal 顯示（autoOpenAI 時自動打開）
  const [showAIModal, setShowAIModal] = useState(autoOpenAI && isPro);

  // ── AIQuizModal onImport：批次 POST 到 /api/quizzes/[id]/questions ─────
  const handleAIImport = async (aiQuestions: AIGeneratedQuestion[], _title: string) => {
    setIsSubmitting(true);
    setShowAIModal(false);

    await fetch(`/api/quizzes/${initialQuiz.id}/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions: aiQuestions }),
    });

    const allDefault = questions.length === 0 || questions.every(q => q.points === 1);
    if (allDefault) {
      await distributePoints(initialQuiz.id);
    }
    setIsSubmitting(false);
    setImportSuccess(true);
    router.refresh();
  };

  // 控制「上傳講義命題」Modal 顯示
  const [showFileGenerator, setShowFileGenerator] = useState(false);

  // ── 從檔案匯入題目 ──────────────────────────────────────────────────
  const handleFileImport = async (fileQuestions: FileGeneratedQuestion[], _title: string) => {
    setIsSubmitting(true);
    setShowFileGenerator(false);

    for (const q of fileQuestions) {
      const type = FILE_TYPE_MAP[q.type];

      if (q.type === 'mc' && q.options?.length) {
        // 選擇題：將 string[] 轉成 { id, text }[]，並找出正確答案的 id
        const options = q.options.map((text, i) => ({
          id: String.fromCharCode(97 + i), // a, b, c, d
          text,
        }));
        // AI 回傳的 answer 可能是字母（"A"）或完整選項文字
        // 先用字母匹配 option id，再用文字完全匹配做 fallback
        const answerKey = q.answer.trim().toLowerCase();
        const byLetter = options.find(o => o.id === answerKey);
        const byText = options.find(o => o.text === q.answer);
        const matched = byLetter ?? byText;
        await createQuestion(initialQuiz.id, {
          type,
          body: q.question,
          options,
          correctAnswers: matched ? [matched.id] : undefined,
          points: 1,
        });
      } else if (q.type === 'tf') {
        // 是非題：將 AI 回傳的 ○/✕ 轉成標準選項 ID
        const ansStr = q.answer.trim();
        const isTrue = ansStr === '○' || ansStr === 'O' || ansStr.toLowerCase() === 'true' || ansStr === '正確';
        await createQuestion(initialQuiz.id, {
          type,
          body: q.question,
          options: [
            { id: 'tf-true', text: '正確' },
            { id: 'tf-false', text: '錯誤' },
          ],
          correctAnswers: [isTrue ? 'tf-true' : 'tf-false'],
          points: 1,
        });
      } else {
        // 填空題 / 簡答題：直接存 answer 字串
        await createQuestion(initialQuiz.id, {
          type,
          body: q.question,
          correctAnswers: q.answer ? [q.answer] : undefined,
          points: 1,
        });
      }
    }

    // 既有題目都還是預設 1 分時才自動平均配分
    const allDefault = questions.length === 0 || questions.every(q => q.points === 1);
    if (allDefault) {
      await distributePoints(initialQuiz.id);
    }
    setIsSubmitting(false);
    router.refresh();
  };

  // ── 題目 CRUD ─────────────────────────────────────────────────────
  const handleAddQuestion = async (data: QuestionFormValues) => {
    setIsSubmitting(true);
    await createQuestion(initialQuiz.id, data);
    // 所有題目都還是預設 1 分時才自動平均配分
    const allDefault = questions.every(q => q.points === 1);
    if (allDefault) {
      await distributePoints(initialQuiz.id);
    }
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
    <div className="mx-auto max-w-3xl space-y-8">
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
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-3 py-1.5 text-xl font-semibold tracking-tight text-foreground hover:border-input focus:border-input focus:outline-none focus:ring-1 focus:ring-ring"
          aria-label="測驗標題"
        />

        {/* 狀態 badge（小色點 + 文字，與 Dashboard 統一） */}
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={`size-1.5 rounded-full ${currentStatus.dot}`}
            aria-hidden="true"
          />
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

        {/* 分享按鈕：含房間碼、QR Code、LINE、Google Classroom、到期設定 */}
        {initialQuiz.accessCode && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowQRModal(true)}
            className="gap-1.5"
          >
            🔗 分享
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

        {/* 匯出 Word 下拉（老師版含答案 / 學生版空白考卷） */}
        {questions.length > 0 && (
          <details className="relative">
            {/* summary 當成按鈕，點擊展開 menu */}
            <summary className="inline-flex h-9 cursor-pointer list-none items-center rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm transition-colors hover:bg-muted [&::-webkit-details-marker]:hidden">
              📥 匯出 Word
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-md border bg-popover text-sm shadow-md">
              <a
                href={`/api/quizzes/${initialQuiz.id}/export?variant=teacher`}
                className="block px-4 py-2 hover:bg-muted"
              >
                👨‍🏫 老師版（含答案）
              </a>
              <a
                href={`/api/quizzes/${initialQuiz.id}/export?variant=student`}
                className="block border-t px-4 py-2 hover:bg-muted"
              >
                📝 學生版（空白考卷）
              </a>
            </div>
          </details>
        )}
      </div>

      {/* 分享 Modal（房間碼 + QR Code + LINE + Google Classroom + 到期） */}
      {showQRModal && initialQuiz.accessCode && (
        <ShareModal
          quizId={initialQuiz.id}
          quizTitle={initialQuiz.title}
          accessCode={initialQuiz.accessCode}
          roomCode={initialQuiz.roomCode}
          expiresAt={initialQuiz.expiresAt instanceof Date ? initialQuiz.expiresAt.toISOString() : (initialQuiz.expiresAt ?? null)}
          onClose={() => setShowQRModal(false)}
        />
      )}

      {/* AI 出題 Modal */}
      {showAIModal && (
        <AIQuizModal
          defaultTopic={buildDefaultTopic(initialQuiz.description)}
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

      {/* ── 測驗設定（可收合） ─────────────────────────────────── */}
      <div className="rounded-xl border bg-card">
        <button
          type="button"
          onClick={() => setSettingsOpen(prev => !prev)}
          className="flex w-full items-center justify-between px-5 py-4 text-left"
        >
          <div className="flex items-center gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">測驗設定</p>
            <span className="text-xs text-muted-foreground">
              {activePreset === 'exam' && '📝 考試模式'}
              {activePreset === 'practice' && '✏️ 練習模式'}
              {activePreset === 'review' && '🔄 複習模式'}
              {!activePreset && '自訂'}
              {showAnswers ? ' · 顯示解答' : ''}
              {preventLeave ? ' · 防作弊' : ''}
            </span>
          </div>
          <svg className={`size-4 text-muted-foreground transition-transform ${settingsOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {settingsOpen && (
          <div className="space-y-5 border-t px-5 pb-5 pt-4">
        {/* 快速套用方案按鈕 */}
        <div className="flex gap-2">
            {(
              [
                {
                  key: 'exam' as const,
                  label: '📝 考試',
                  active: 'border-gray-900 bg-gray-900 text-white',
                  hover: 'hover:border-gray-400',
                },
                {
                  key: 'practice' as const,
                  label: '✏️ 練習',
                  active: 'border-amber-400 bg-amber-400 text-white',
                  hover: 'hover:border-amber-300',
                },
                {
                  key: 'review' as const,
                  label: '🔄 複習',
                  active: 'border-blue-500 bg-blue-500 text-white',
                  hover: 'hover:border-blue-300',
                },
              ]
            ).map(p => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p.key)}
                disabled={isPending}
                className={`flex items-center gap-1.5 rounded-lg border-2 px-5 py-2.5 text-sm font-semibold transition-all duration-150 ${
                  activePreset === p.key
                    ? p.active
                    : `border bg-card text-muted-foreground ${p.hover}`
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

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
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Switch
              checked={preventLeave}
              onCheckedChange={handlePreventLeaveChange}
              disabled={isPending}
            />
            防止學生中途離開（考試防作弊）
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
        )}
      </div>

      {/* ── 匯入成功引導 ── */}
      {importSuccess && questions.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 px-5 py-4">
          <span className="mt-0.5 text-lg">✅</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-green-800">
              {questions.length}
              {' '}
              題已匯入！接下來只要三步：
            </p>
            <ol className="mt-2 space-y-1 text-xs text-green-700">
              <li>1. 往下滑檢查題目，有問題可以點「編輯」修改</li>
              <li>2. 確認沒問題後，按上方的「<strong>發佈測驗</strong>」</li>
              <li>3. 點「<strong>分享</strong>」把連結傳給學生</li>
            </ol>
            <button
              type="button"
              onClick={() => setImportSuccess(false)}
              className="mt-2 text-xs text-green-600 hover:underline"
            >
              知道了，關閉提示
            </button>
          </div>
        </div>
      )}

      {/* ── 題目清單 ────────────────────────────────────────────── */}
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">
            題目
            <span className="ml-1 text-base font-normal text-muted-foreground">
              （
              {questions.length}
              ）
            </span>
          </h2>
          {questions.length > 1 && (
            <span className="text-xs text-muted-foreground">拖曳左側圓點可排序</span>
          )}
          {questions.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setDistributeMsg('');
                startTransition(async () => {
                  await distributePoints(initialQuiz.id);
                  setDistributeMsg('已平均分配，總分 100 分');
                  router.refresh();
                  // 3 秒後自動消除提示
                  setTimeout(() => setDistributeMsg(''), 3000);
                });
              }}
              disabled={isPending}
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-50"
            >
              ⚖️ 平均配分（總分 100）
            </button>
          )}
          {distributeMsg && (
            <span className="text-xs font-medium text-green-600">{distributeMsg}</span>
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
                          quizId={initialQuiz.id}
                          defaultValues={{
                            type: question.type,
                            body: question.body,
                            imageUrl: question.imageUrl ?? '',
                            audioUrl: question.audioUrl ?? '',
                            audioTranscript: question.audioTranscript ?? '',
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
                        onAudioRegenerated={async (questionId, audioUrl) => {
                          await updateQuestion(questionId, initialQuiz.id, {
                            type: question.type,
                            body: question.body,
                            options: question.options ?? undefined,
                            correctAnswers: question.correctAnswers ?? undefined,
                            points: question.points,
                            audioUrl,
                          });
                          router.refresh();
                        }}
                      />
                    ),
              )}
            </div>
          </SortableContext>
        </DndContext>

        {questions.length === 0 && !addingNew && (
          <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            還沒有題目，點選下方按鈕新增第一題
          </div>
        )}
      </div>

      {/* ── 新增題目 ────────────────────────────────────────────── */}
      {addingNew
        ? (
            <QuestionForm
              quizId={initialQuiz.id}
              onSubmit={handleAddQuestion}
              onCancel={() => setAddingNew(false)}
              isPending={isSubmitting}
            />
          )
        : (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setAddingNew(true);
              }}
              className="w-full rounded-xl border border-dashed py-3.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              + 新增題目
            </button>
          )}
    </div>
  );
}
