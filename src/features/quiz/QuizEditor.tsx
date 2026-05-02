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
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { getAiUsageRemainingForCurrentUser } from '@/actions/aiUsageActions';
import { createLiveGame } from '@/actions/liveActions';
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
import { PublishMarketplaceDialog } from '@/components/quiz/PublishMarketplaceDialog';
import ShareModal from '@/components/quiz/ShareModal';
import VocabAIModal from '@/components/quiz/VocabAIModal';
import VocabCardModal from '@/components/quiz/VocabCardModal';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { type AiUsageInfo, formatAiUsageMessage } from '@/lib/aiUsageMessage';
import type { questionSchema, quizSchema } from '@/models/Schema';

import { InlineQuestionCard } from './InlineQuestionCard';
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

// 匯入中的 pending 題目（灰階 preview 用，API 未完成前暫代）
type PendingQuestion = {
  tempId: string; // client 端唯一 key
  body: string;
  hasOptions: boolean;
  options: Array<{ id: string; text: string }>; // 空陣列代表非選擇題
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
  if (!description) {
    return '';
  }
  let desc = description;
  for (const phrase of STUDENT_FACING_PHRASES) {
    desc = desc.replace(phrase, '');
  }
  desc = desc.trim();
  if (!desc) {
    return '';
  }
  return desc;
}

// CreateQuizWithAIButton 預設標題格式「AI 出題 M/D」;符合此 pattern 才允許自動覆寫,
// 已被用戶手動改過的標題不動。月日為 1-2 位數字。
const DEFAULT_AI_TITLE_RE = /^AI 出題 \d{1,2}\/\d{1,2}$/;

// 從 AI 回傳的試卷標題抽出主題前綴(≤15 字),拼到預設標題前面變成
// 「光合作用 - AI 出題 4/26」這種有辨識度的命名
function deriveTopicPrefix(aiTitle: string): string {
  if (!aiTitle) {
    return '';
  }
  // 去掉頭尾常見的引號 / 破折號 / 冒號 / 空白,只留主題本身
  const cleaned = aiTitle
    .trim()
    .replace(/^[—\-:：「『（(\s]+/, '')
    .replace(/[—\-:：」』）)\s]+$/, '')
    .trim();
  if (!cleaned) {
    return '';
  }
  // Array.from 確保 emoji / surrogate pair 一個 code point 算一字
  const chars = Array.from(cleaned);
  return chars.slice(0, 15).join('');
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

  // 匯入中的灰階 preview 題目（樂觀 UI：Modal 關閉後立刻顯示、真題目到位清掉）
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestion[]>([]);

  // 同步 initialQuestions prop → local state
  // 原因：router.refresh() 會讓 server component 重新傳入新的 initialQuestions，
  // 但 useState(initialQuestions) 只在第一次 render 讀取 prop，後續不會自動更新。
  // 沒有這個 sync，AI 匯入、新增題目、編輯題目、講義匯入後畫面都不會即時更新
  // （要手動 F5 才看得到）。
  useEffect(() => {
    setQuestions(initialQuestions);
    // 真題目到位後清掉灰階 pending（避免 empty flash）
    setPendingQuestions([]);
  }, [initialQuestions]);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);
  // 本月 AI 出題用量（AiUsageInfo），顯示在匯入成功 banner
  const [aiUsage, setAiUsage] = useState<AiUsageInfo | null>(null);

  // 平均配分成功提示
  const [distributeMsg, setDistributeMsg] = useState('');

  // Live Mode 錯誤訊息
  const [liveError, setLiveError] = useState<string | null>(null);

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

  // 新建測驗的提示 banner：顯示在頂部，引導「審完題後再分享」
  // 不自動彈 ShareModal，避免打斷老師審題
  //
  // hydration 注意：App Router 中 useSearchParams() 在 SSR 期間拿不到 URL query，
  // 必須延到 mount 之後才讀，否則 server 初始 HTML（banner 不顯示）會跟
  // client hydration（banner 顯示）不匹配，觸發 React #418 hydration error。
  const searchParams = useSearchParams();
  const [showJustCreatedBanner, setShowJustCreatedBanner] = useState(false);
  useEffect(() => {
    if (searchParams.get('just_created') === '1') {
      setShowJustCreatedBanner(true);
    }
  }, [searchParams]);
  const dismissJustCreatedBanner = () => {
    setShowJustCreatedBanner(false);
    // 清掉 URL 參數，避免重新整理時又出現
    const url = new URL(window.location.href);
    url.searchParams.delete('just_created');
    window.history.replaceState(null, '', url.toString());
  };

  // 控制 AIQuizModal 顯示
  const [showAIModal, setShowAIModal] = useState(false);

  // autoOpenAI：首次進入時自動打開 AI Modal，並移除 URL 的 ?ai=1 避免重複觸發
  useEffect(() => {
    if (autoOpenAI && isPro) {
      setShowAIModal(true);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [autoOpenAI, isPro]);

  // ── AIQuizModal onImport：批次 POST 到 /api/quizzes/[id]/questions ─────
  const handleAIImport = async (aiQuestions: AIGeneratedQuestion[], aiTitle: string) => {
    setIsSubmitting(true);
    setShowAIModal(false);

    // 樂觀 UI：把 AI 題目立刻轉成 pending preview 顯示（灰階卡片）
    // API 完成後會由 useEffect（監聽 initialQuestions）清掉
    const batchId = Date.now();
    setPendingQuestions(
      aiQuestions.map((q, i) => ({
        tempId: `pending-${batchId}-${i}`,
        body: q.question,
        hasOptions: !!q.options && q.options.length > 0,
        options: (q.options ?? []).map((text, j) => ({
          id: String.fromCharCode(65 + j), // A / B / C / D
          text,
        })),
      })),
    );

    const res = await fetch(`/api/quizzes/${initialQuiz.id}/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions: aiQuestions }),
    });

    // 之前沒檢查 res.ok，API 回 401/400/500 時還是照樣顯示「匯入成功」，
    // 導致用戶看到題目 (0) 卻不知道為什麼
    if (!res.ok) {
      setPendingQuestions([]); // 失敗清掉灰階 preview
      setIsSubmitting(false);
      const msg = await res.text().catch(() => '');
      // eslint-disable-next-line no-alert
      alert(`匯入失敗（${res.status}）${msg ? `：${msg}` : ''}`);
      return;
    }

    const allDefault = questions.length === 0 || questions.every(q => q.points === 1);
    if (allDefault) {
      await distributePoints(initialQuiz.id);
    }

    // 預設標題「AI 出題 M/D」太空泛,把 AI 回傳的試卷標題擷取 ≤15 字放在前面;
    // 若用戶已手動改過標題就不覆蓋(避免改掉 user 的命名)
    const topicPrefix = deriveTopicPrefix(aiTitle);
    if (topicPrefix && DEFAULT_AI_TITLE_RE.test(title)) {
      const newTitle = `${topicPrefix} - ${title}`;
      setTitle(newTitle);
      try {
        await updateQuiz(initialQuiz.id, { title: newTitle, status });
      } catch (err) {
        // 更新標題失敗不阻擋題目匯入(題目已成功)
        console.error('[handleAIImport] 更新標題失敗', err);
      }
    }

    // 取本月 AI 出題使用次數,塞進 importSuccess banner 顯示
    // 失敗不影響題目匯入,只是不顯示 usage 那行
    try {
      const usage = await getAiUsageRemainingForCurrentUser();
      if (usage) {
        setAiUsage(usage);
      }
    } catch (err) {
      console.error('[handleAIImport] 取本月 AI 用量失敗', err);
    }

    setIsSubmitting(false);
    setImportSuccess(true);
    router.refresh(); // pending 由 useEffect 監聽 initialQuestions 變化後清
  };

  // 控制「上傳講義命題」Modal 顯示
  const [showFileGenerator, setShowFileGenerator] = useState(false);
  const [showVocabModal, setShowVocabModal] = useState(false);
  const [showMarketplace, setShowMarketplace] = useState(false);

  // ── VocabCardModal onImport：直接以 { body, correctAnswers } 形狀建立題目 ──
  const handleVocabImport = async (
    vocabQuestions: Array<{
      type: string;
      body: string;
      options: Array<{ id: string; text: string }>;
      correctAnswers: string[];
      points: number;
    }>,
  ) => {
    setIsSubmitting(true);
    setShowVocabModal(false);

    for (const q of vocabQuestions) {
      await createQuestion(initialQuiz.id, {
        type: 'short_answer',
        body: q.body,
        correctAnswers: q.correctAnswers,
        points: q.points,
      });
    }

    setIsSubmitting(false);
    router.refresh();
  };

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
      {/* ── 新建測驗引導 banner：審完題後點按鈕分享 ─────────────── */}
      {showJustCreatedBanner && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 shadow-sm">
          <span className="text-xl">✅</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-900">
              測驗已建立，建議先匯入或新增題目並審題
            </p>
            <p className="text-xs text-amber-700">
              審完題目後，按右側按鈕立即分享給學生 →
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setShowQRModal(true);
              dismissJustCreatedBanner();
            }}
            className="shrink-0 bg-amber-500 text-white hover:bg-amber-600"
          >
            🔗 立即分享
          </Button>
          <button
            type="button"
            onClick={dismissJustCreatedBanner}
            className="shrink-0 text-xs text-amber-700 hover:text-amber-900"
            aria-label="關閉提示"
          >
            ✕
          </button>
        </div>
      )}

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
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleStatusChange('draft')}
            disabled={isPending}
          >
            取消發佈
          </Button>
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

        {/* 主要按鈕：分享 + AI 出題 */}
        {initialQuiz.accessCode && (
          <Button size="sm" variant="outline" onClick={() => setShowQRModal(true)} className="gap-1.5">
            🔗 分享
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setLiveError(null);
            startTransition(async () => {
              // try/catch 防止 Server Action throw（例如 DB migration 未跑、
              // live_game 表不存在）導致整頁白屏「Application error」。
              try {
                const res = await createLiveGame({ quizId: initialQuiz.id });
                // DEBUG：把完整 res 印到 console，定位後會拔掉

                console.warn('[QuizEditor createLiveGame result]', res);
                if (!res || typeof res !== 'object') {
                  // server action 回 undefined：常見原因為 Clerk session 中斷、Next.js RSC flight 解析失敗
                  setLiveError('Live Mode 建立失敗：伺服器未回應（可能需重新登入）');
                  return;
                }
                if ('error' in res) {
                  setLiveError(res.error ?? '建立失敗');
                  return;
                }
                if (!('gameId' in res)) {
                  setLiveError('Live Mode 建立失敗：伺服器回傳異常');
                  return;
                }
                router.push(`/dashboard/live/host/${res.gameId}`);
              } catch (err) {
                console.error('[QuizEditor createLiveGame catch]', err);
                setLiveError(
                  err instanceof Error
                    ? `Live Mode 建立失敗：${err.message}`
                    : 'Live Mode 建立失敗，請稍後再試',
                );
              }
            });
          }}
          disabled={isPending || status !== 'published'}
          title={status !== 'published' ? '請先發佈測驗' : '開啟 Live Mode 直播'}
          className="gap-1.5"
        >
          🎮 Live Mode
        </Button>
        {isPro && (
          <Button size="sm" variant="outline" onClick={() => setShowAIModal(true)} disabled={isSubmitting} className="gap-1.5">
            ✨ AI 出題
          </Button>
        )}

        {/* 更多操作（收合） */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">⋯ 更多</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {isPro && (
              <>
                <DropdownMenuItem onClick={() => setShowFileGenerator(true)}>
                  📂 上傳講義命題
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowVocabModal(true)}>
                  🔤 AI 單字卡
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem onClick={() => setShowMarketplace(true)}>
              {initialQuiz.visibility === 'public' ? '✅ 管理市集上架' : '📤 分享到市集'}
            </DropdownMenuItem>
            {questions.length > 0 && (
              <>
                <DropdownMenuItem asChild>
                  <a href={`/api/quizzes/${initialQuiz.id}/export?variant=teacher`}>
                    📥 匯出 Word（老師版）
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={`/api/quizzes/${initialQuiz.id}/export?variant=student`}>
                    📄 匯出 Word（學生版）
                  </a>
                </DropdownMenuItem>
              </>
            )}
            {status === 'published' && (
              <DropdownMenuItem onClick={() => handleStatusChange('closed')} className="text-destructive">
                🚫 關閉作答
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {liveError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {liveError}
        </div>
      )}

      {/* 分享 Modal（房間碼 + QR Code + LINE + Google Classroom + 到期） */}
      {showQRModal && initialQuiz.accessCode && (
        <ShareModal
          quizId={initialQuiz.id}
          quizTitle={initialQuiz.title}
          accessCode={initialQuiz.accessCode}
          roomCode={initialQuiz.roomCode}
          expiresAt={initialQuiz.expiresAt instanceof Date ? initialQuiz.expiresAt.toISOString() : (initialQuiz.expiresAt ?? null)}
          currentVisibility={initialQuiz.visibility}
          currentSlug={initialQuiz.slug}
          status={initialQuiz.status}
          onClose={() => setShowQRModal(false)}
        />
      )}

      {/* AI 出題 Modal（vocab 模式用專屬單字生成器） */}
      {showAIModal && initialQuiz.quizMode === 'vocab' && (
        <VocabAIModal
          defaultTopic={buildDefaultTopic(initialQuiz.description)}
          onImport={handleAIImport}
          onClose={() => setShowAIModal(false)}
        />
      )}
      {showAIModal && initialQuiz.quizMode !== 'vocab' && (
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

      {/* AI 單字卡 Modal */}
      {showVocabModal && (
        <VocabCardModal
          onImport={handleVocabImport}
          onClose={() => setShowVocabModal(false)}
        />
      )}

      {/* 題庫市集 Dialog */}
      {showMarketplace && (
        <PublishMarketplaceDialog
          quizId={initialQuiz.id}
          isPublic={initialQuiz.visibility === 'public'}
          initialCategory={initialQuiz.category}
          initialGradeLevel={initialQuiz.gradeLevel}
          initialTags={initialQuiz.tags}
          onClose={() => {
            setShowMarketplace(false);
            router.refresh();
          }}
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
      {importSuccess && questions.length > 0 && (() => {
        // 在 render 時從 aiUsage derive 文案,符合 React 最佳實踐
        // 「rerender-derived-state-no-effect」: 能 derive 就不要存 state
        const aiUsageMsg = aiUsage ? formatAiUsageMessage(aiUsage) : null;
        return (
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
                <li>
                  2. 確認沒問題後，按上方的「
                  <strong>發佈測驗</strong>
                  」
                </li>
                <li>
                  3. 點「
                  <strong>分享</strong>
                  」把連結傳給學生
                </li>
              </ol>
              {aiUsageMsg && (
                <p
                  className={`mt-2 text-xs ${
                    aiUsageMsg.isWarning
                      ? 'font-medium text-red-600'
                      : 'text-green-700'
                  }`}
                >
                  {aiUsageMsg.isWarning
                    ? (
                        <>
                          {aiUsageMsg.text}
                          {' '}
                          <Link
                            href="/dashboard/billing"
                            className="underline hover:text-red-700"
                          >
                            升級 →
                          </Link>
                        </>
                      )
                    : aiUsageMsg.text}
                </p>
              )}
              <button
                type="button"
                onClick={() => {
                  setImportSuccess(false);
                  setAiUsage(null);
                }}
                className="mt-2 text-xs text-green-600 hover:underline"
              >
                知道了，關閉提示
              </button>
            </div>
          </div>
        );
      })()}

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
                  : question.type === 'single_choice' || question.type === 'multiple_choice'
                    ? (
                        // 選擇題用 inline 編輯卡片（題目 + 選項 + 正解勾選皆可直接改）
                        // onEdit 觸發後切到 QuestionForm 完整編輯模式（圖片、解析、配分）
                        <InlineQuestionCard
                          key={question.id}
                          question={question}
                          index={index}
                          quizId={initialQuiz.id}
                          onEdit={() => {
                            setAddingNew(false);
                            setEditingId(question.id);
                          }}
                          onDelete={() => handleDeleteQuestion(question.id)}
                          isDeleting={deletingId === question.id}
                          isPro={isPro}
                        />
                      )
                    : (
                        // 非選擇題（tf / fill / short / rank / listening）維持原摘要卡 + Modal 編輯，保留音訊重生成
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

              {/* ── 匯入中：灰階 preview（樂觀 UI，避免使用者以為卡住）── */}
              {pendingQuestions.map((pq, i) => (
                <div
                  key={pq.tempId}
                  className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <div className="size-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    <span className="text-xs font-medium text-primary">
                      匯入中 Q
                      {questions.length + i + 1}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-sm font-medium text-foreground/80">
                    {pq.body}
                  </p>
                  {pq.hasOptions && pq.options.length > 0 && (
                    <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                      {pq.options.map(opt => (
                        <div
                          key={opt.id}
                          className="line-clamp-1 rounded border border-muted-foreground/10 bg-background/50 px-2 py-1 text-xs text-muted-foreground"
                        >
                          {opt.id}
                          .
                          {' '}
                          {opt.text}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {questions.length === 0 && pendingQuestions.length === 0 && !addingNew && (
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
