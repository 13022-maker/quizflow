'use client';

import type { InferSelectModel } from 'drizzle-orm';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import type { SubmitResult } from '@/actions/responseActions';
import { checkAttemptCount, submitQuizResponse } from '@/actions/responseActions';
import { Button } from '@/components/ui/button';
import type { questionSchema, quizSchema } from '@/models/Schema';

import { FlashCard } from './FlashCard';

// 只有當測驗包含 ranking 題時才會載入 survey-react-ui，
// 避免一般測驗的學生作答頁被 ~200KB 的依賴拖累
const RankingQuestion = dynamic(
  () => import('./RankingQuestion').then(m => m.RankingQuestion),
  {
    ssr: false,
    loading: () => <p className="text-sm text-muted-foreground">載入排序題…</p>,
  },
);

type Quiz = InferSelectModel<typeof quizSchema>;
type Question = InferSelectModel<typeof questionSchema>;

// 弱點分析結果型別
type WeakPoint = { concept: string; suggestion: string };

// 錯題重做結果型別
type RetryResult = { correct: number; total: number };

// ── 個別題目元件 ─────────────────────────────────────────────────

function QuestionItem({
  question,
  index,
  answer,
  onChange,
}: {
  question: Question;
  index: number;
  answer: string | string[] | undefined;
  onChange: (value: string | string[]) => void;
}) {
  // 是非題若 DB 中沒有 options，自動補上預設選項
  const TRUE_FALSE_DEFAULTS = [
    { id: 'tf-true', text: '正確' },
    { id: 'tf-false', text: '錯誤' },
  ];
  const options = question.type === 'true_false' && (!question.options || question.options.length === 0)
    ? TRUE_FALSE_DEFAULTS
    : (question.options ?? []);

  const handleSingleChange = (optionId: string) => onChange(optionId);

  const handleMultiChange = (optionId: string, checked: boolean) => {
    const current = Array.isArray(answer) ? answer : [];
    onChange(checked ? [...current, optionId] : current.filter(id => id !== optionId));
  };

  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="mb-3 flex items-start gap-2">
        <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
          Q
          {index + 1}
        </span>
        <p className="font-medium leading-snug">{question.body}</p>
      </div>

      {/* 題目圖片 */}
      {question.imageUrl && (
        <div className="mb-4 flex items-center justify-center overflow-hidden rounded-lg border border-[#e0e0e0] bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={question.imageUrl}
            alt="題目圖片"
            className="max-h-[400px] w-full object-contain"
            onError={(e) => {
              const el = e.target as HTMLImageElement;
              el.style.display = 'none';
              el.parentElement!.innerHTML = '<p class="py-6 text-sm text-muted-foreground">圖片無法載入</p>';
            }}
          />
        </div>
      )}

      {/* 單選題 / 是非題 */}
      {(question.type === 'single_choice' || question.type === 'true_false') && (
        <div className="space-y-2 pl-2">
          {options.map(opt => (
            <label key={opt.id} className="flex cursor-pointer items-center gap-3">
              <input
                type="radio"
                name={`q-${question.id}`}
                value={opt.id}
                checked={answer === opt.id}
                onChange={() => handleSingleChange(opt.id)}
                className="size-4 accent-primary"
              />
              <span className="text-sm">{opt.text}</span>
            </label>
          ))}
        </div>
      )}

      {/* 多選題 */}
      {question.type === 'multiple_choice' && (
        <div className="space-y-2 pl-2">
          <p className="mb-2 text-xs text-muted-foreground">可選多個答案</p>
          {options.map(opt => (
            <label key={opt.id} className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                value={opt.id}
                checked={Array.isArray(answer) && answer.includes(opt.id)}
                onChange={e => handleMultiChange(opt.id, e.target.checked)}
                className="size-4 accent-primary"
              />
              <span className="text-sm">{opt.text}</span>
            </label>
          ))}
        </div>
      )}

      {/* 簡答題 */}
      {question.type === 'short_answer' && (
        <textarea
          value={typeof answer === 'string' ? answer : ''}
          onChange={e => onChange(e.target.value)}
          rows={3}
          placeholder="請輸入你的答案..."
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      )}

      {/* 排序題 */}
      {question.type === 'ranking' && (
        <div className="pl-2">
          <p className="mb-2 text-xs text-muted-foreground">請拖曳選項排出正確順序</p>
          <RankingQuestion
            questionId={question.id}
            options={options}
            value={Array.isArray(answer) ? answer : undefined}
            onChange={v => onChange(v)}
          />
        </div>
      )}
    </div>
  );
}

// ── 成績畫面（含 AI 弱點分析 + 錯題重做按鈕） ──────────────────

function ResultScreen({
  result,
  questions,
  answers,
  showAnswers,
  onRetry,
}: {
  result: SubmitResult;
  questions: Question[];
  answers: Record<number, string | string[]>;
  showAnswers: boolean;
  onRetry: () => void;
}) {
  const percentage = result.totalPoints > 0
    ? Math.round((result.score / result.totalPoints) * 100)
    : 0;

  const hasShortAnswer = questions.some(q => q.type === 'short_answer');

  // 可重做的錯題（排除簡答題）
  const retryableWrongCount = result.details.filter(
    d => d.isCorrect === false && questions.find(q => q.id === d.questionId)?.type !== 'short_answer',
  ).length;

  // ── AI 弱點分析狀態 ───────────────────────────────────────────
  const [weakPoints, setWeakPoints] = useState<WeakPoint[] | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState('');

  // 有顯示解答且有答錯時，自動呼叫 AI 分析
  useEffect(() => {
    if (!showAnswers) {
      return;
    }

    const wrongQuestions = result.details
      .filter(d => d.isCorrect === false)
      .map((d) => {
        const q = questions.find(qItem => qItem.id === d.questionId);
        if (!q || q.type === 'short_answer') {
          return null;
        }

        const tfDefs = [{ id: 'tf-true', text: '正確' }, { id: 'tf-false', text: '錯誤' }];
        const options = q.type === 'true_false' && (!q.options || q.options.length === 0)
          ? tfDefs
          : (q.options ?? []);
        const studentAns = answers[d.questionId];
        // 排序題用 → 串接，其他題型用 、 串接
        const sep = q.type === 'ranking' ? ' → ' : '、';
        const studentText = Array.isArray(studentAns)
          ? studentAns.map(id => options.find(o => o.id === id)?.text ?? id).join(sep)
          : options.find(o => o.id === studentAns)?.text ?? studentAns ?? '（未作答）';

        const correctText = (q.correctAnswers ?? [])
          .map(id => options.find(o => o.id === id)?.text ?? id)
          .join(sep);

        return { question: q.body, correctAnswer: correctText, studentAnswer: String(studentText) };
      })
      .filter(Boolean) as { question: string; correctAnswer: string; studentAnswer: string }[];

    if (wrongQuestions.length === 0) {
      return;
    }

    setAnalysisLoading(true);
    fetch('/api/ai/analyze-weak-points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wrongQuestions }),
    })
      .then(res => res.json())
      .then((data) => {
        if (data.weakPoints) {
          setWeakPoints(data.weakPoints);
        } else {
          setAnalysisError('分析失敗，請稍後再試');
        }
      })
      .catch(() => setAnalysisError('分析失敗，請稍後再試'))
      .finally(() => setAnalysisLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      {/* 總分 */}
      <div className="rounded-lg border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">作答完成</p>
        <p className="mt-2 text-5xl font-bold">
          {result.score}
          <span className="text-2xl text-muted-foreground">
            /
            {result.totalPoints}
          </span>
        </p>
        <p className="mt-1 text-lg text-muted-foreground">
          {percentage}
          %
        </p>
        {hasShortAnswer && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
            簡答題需老師批改，最終成績可能有所調整。
          </p>
        )}

        {/* 錯題重做按鈕 */}
        {retryableWrongCount > 0 && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 rounded-lg border border-primary px-5 py-2 text-sm font-medium text-primary hover:bg-primary/10"
          >
            重做錯題（
            {retryableWrongCount}
            {' '}
            題）
          </button>
        )}
      </div>

      {/* AI 弱點分析區塊（有答錯且有解答時顯示） */}
      {showAnswers && (
        <div className="rounded-lg border bg-blue-50/60 p-5">
          <h3 className="mb-3 font-semibold text-blue-800">需要加強的概念</h3>
          {analysisLoading && (
            <p className="text-sm text-blue-700">AI 正在分析你的學習弱點…</p>
          )}
          {analysisError && (
            <p className="text-sm text-red-600">{analysisError}</p>
          )}
          {weakPoints !== null && weakPoints.length === 0 && (
            <p className="text-sm text-blue-700">太棒了！本次沒有答錯的題目。</p>
          )}
          {weakPoints && weakPoints.length > 0 && (
            <ul className="space-y-3">
              {weakPoints.map(wp => (
                <li key={wp.concept} className="rounded-md bg-white px-4 py-3 text-sm shadow-sm">
                  <p className="font-medium text-blue-900">{wp.concept}</p>
                  <p className="mt-0.5 text-muted-foreground">{wp.suggestion}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 逐題對照（showAnswers = false 時隱藏） */}
      {!showAnswers && (
        <p className="rounded-md bg-muted px-4 py-3 text-center text-sm text-muted-foreground">
          老師已關閉解答顯示。
        </p>
      )}
      {showAnswers && (
        <div className="space-y-3">
          {questions.map((question, index) => {
            const detail = result.details.find(d => d.questionId === question.id);
            const studentAnswer = answers[question.id];
            const tfDefaults = [{ id: 'tf-true', text: '正確' }, { id: 'tf-false', text: '錯誤' }];
            const options = question.type === 'true_false' && (!question.options || question.options.length === 0)
              ? tfDefaults
              : (question.options ?? []);
            const isShort = question.type === 'short_answer';

            const borderColor = isShort
              ? 'border-gray-200'
              : detail?.isCorrect
                ? 'border-green-300 bg-green-50/50'
                : 'border-red-300 bg-red-50/50';

            return (
              <div key={question.id} className={`rounded-lg border p-4 ${borderColor}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">
                    Q
                    {index + 1}
                    .
                    {' '}
                    {question.body}
                  </p>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {detail?.points}
                    {' '}
                    分
                  </span>
                </div>

                {/* 學生的答案 */}
                <div className="mt-2 text-sm">
                  <span className="text-muted-foreground">你的答案：</span>
                  {Array.isArray(studentAnswer)
                    ? studentAnswer
                      .map(id => options.find(o => o.id === id)?.text ?? id)
                      .join(question.type === 'ranking' ? ' → ' : '、')
                    : typeof studentAnswer === 'string'
                      ? (options.find(o => o.id === studentAnswer)?.text ?? studentAnswer) || (
                          <span className="italic text-muted-foreground">未作答</span>
                        )
                      : <span className="italic text-muted-foreground">未作答</span>}
                </div>

                {/* 正確答案（非簡答題且答錯） */}
                {!isShort && detail?.isCorrect === false && question.correctAnswers && (
                  <div className="mt-1 text-sm text-green-700">
                    <span className="text-muted-foreground">正確答案：</span>
                    {question.correctAnswers
                      .map(id => options.find(o => o.id === id)?.text ?? id)
                      .join(question.type === 'ranking' ? ' → ' : '、')}
                  </div>
                )}

                {isShort && (
                  <p className="mt-1 text-xs text-muted-foreground">待老師批改</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 錯題重做畫面 ──────────────────────────────────────────────────

function RetryScreen({
  wrongQuestions,
  originalWrongCount,
  onBack,
}: {
  wrongQuestions: Question[];
  originalWrongCount: number;
  onBack: () => void;
}) {
  const [retryAnswers, setRetryAnswers] = useState<Record<number, string | string[]>>({});
  const [retryResult, setRetryResult] = useState<RetryResult | null>(null);
  const [error, setError] = useState('');

  const handleRetrySubmit = () => {
    // 檢查是否全部作答
    const unanswered = wrongQuestions.filter(q => !retryAnswers[q.id]);
    if (unanswered.length > 0) {
      setError(`還有 ${unanswered.length} 題未作答`);
      return;
    }
    setError('');

    // 本機批改（不送 server，不計入正式統計）
    let correct = 0;
    wrongQuestions.forEach((q) => {
      const ans = retryAnswers[q.id];
      if (!q.correctAnswers || !ans) {
        return;
      }

      if (q.type === 'single_choice' || q.type === 'true_false') {
        if (q.correctAnswers.includes(ans as string)) {
          correct++;
        }
      } else if (q.type === 'multiple_choice') {
        const given = Array.isArray(ans) ? [...ans].sort() : [];
        const expected = [...q.correctAnswers].sort();
        if (JSON.stringify(given) === JSON.stringify(expected)) {
          correct++;
        }
      } else if (q.type === 'ranking') {
        // 排序題：完全相同才算對
        const given = Array.isArray(ans) ? ans : [];
        if (JSON.stringify(given) === JSON.stringify(q.correctAnswers)) {
          correct++;
        }
      }
    });

    setRetryResult({ correct, total: wrongQuestions.length });
  };

  // 顯示重做結果
  if (retryResult) {
    const improved = retryResult.correct;
    return (
      <div className="space-y-6">
        <div className="rounded-lg border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">錯題重做完成！</p>
          <div className="mt-4 flex items-center justify-center gap-4">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">上次</p>
              <p className="text-3xl font-bold text-red-500">0</p>
              <p className="text-xs text-muted-foreground">
                /
                {originalWrongCount}
              </p>
            </div>
            <span className="text-2xl text-muted-foreground">→</span>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">這次</p>
              <p className={`text-3xl font-bold ${improved === retryResult.total ? 'text-green-600' : 'text-amber-600'}`}>
                {improved}
              </p>
              <p className="text-xs text-muted-foreground">
                /
                {retryResult.total}
              </p>
            </div>
          </div>
          {improved === retryResult.total && (
            <p className="mt-4 text-sm font-medium text-green-700">全部答對！進步顯著！</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">此次重做成績不計入正式統計</p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="w-full rounded-lg border px-4 py-2 text-sm text-muted-foreground hover:bg-muted"
        >
          返回成績頁
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 提示 */}
      <div className="rounded-lg border bg-amber-50 p-4">
        <p className="text-sm font-medium text-amber-800">錯題重做模式</p>
        <p className="mt-0.5 text-xs text-amber-700">
          共
          {' '}
          {wrongQuestions.length}
          {' '}
          題 · 此次成績不計入正式統計
        </p>
      </div>

      {/* 題目 */}
      {wrongQuestions.map((question, index) => (
        <QuestionItem
          key={question.id}
          question={question}
          index={index}
          answer={retryAnswers[question.id]}
          onChange={value => setRetryAnswers(prev => ({ ...prev, [question.id]: value }))}
        />
      ))}

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 rounded-lg border px-4 py-2 text-sm text-muted-foreground hover:bg-muted"
        >
          返回
        </button>
        <Button onClick={handleRetrySubmit} className="flex-1">
          送出重做
        </Button>
      </div>
    </div>
  );
}

// ── Fisher-Yates shuffle ──────────────────────────────────────────
function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

// ── 主元件 ────────────────────────────────────────────────────────

export function QuizTaker({ quiz, questions }: { quiz: Quiz; questions: Question[] }) {
  // 隨機排序只在掛載時執行一次
  const [displayQuestions] = useState<Question[]>(() => {
    const ordered = quiz.shuffleQuestions ? shuffle(questions) : questions;
    return ordered.map((q) => {
      // 排序題：永遠強制打亂選項，否則學生「不拖也對」
      if (q.type === 'ranking' && q.options) {
        return { ...q, options: shuffle(q.options) };
      }
      if (quiz.shuffleOptions && q.options) {
        return { ...q, options: shuffle(q.options) };
      }
      return q;
    });
  });

  const [answers, setAnswers] = useState<Record<number, string | string[]>>({});
  const [studentName, setStudentName] = useState('');
  const [studentEmail, setStudentEmail] = useState('');

  // 快閃卡複習模式
  const [flashCardMode, setFlashCardMode] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  // 錯題重做狀態
  const [retryMode, setRetryMode] = useState(false);

  // 可重做的錯題（非簡答題且答錯）
  const retryQuestions = useMemo(() => {
    if (!result) {
      return [];
    }
    return displayQuestions.filter(
      q =>
        q.type !== 'short_answer'
        && result.details.some(d => d.questionId === q.id && d.isCorrect === false),
    );
  }, [result, displayQuestions]);

  // 倒數計時器
  const [timeLeft, setTimeLeft] = useState<number | null>(quiz.timeLimitSeconds ?? null);
  const autoSubmittedRef = useRef(false);

  const handleAnswer = (questionId: number, value: string | string[]) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  const handleSubmit = (skipValidation = false) => {
    if (!skipValidation) {
      const unanswered = displayQuestions.filter((q) => {
        if (q.type === 'short_answer') {
          return false;
        }
        const ans = answers[q.id];
        // 排序題：必須拖完所有選項才算作答完成
        if (q.type === 'ranking') {
          const expectedLen = q.options?.length ?? 0;
          return !Array.isArray(ans) || ans.length !== expectedLen;
        }
        return !ans;
      });
      if (unanswered.length > 0) {
        setError(`還有 ${unanswered.length} 題未作答`);
        return;
      }
    }
    setError('');

    startTransition(async () => {
      try {
        if (quiz.allowedAttempts && studentEmail) {
          const attemptCount = await checkAttemptCount(quiz.id, studentEmail);
          if (attemptCount >= quiz.allowedAttempts) {
            setError('您已達到作答上限，無法再次提交。');
            return;
          }
        }
        // 將 answers key 轉為 string（Server Action 序列化需要）
        const stringKeyAnswers: Record<string, string | string[]> = {};
        for (const [key, value] of Object.entries(answers)) {
          stringKeyAnswers[String(key)] = value;
        }

        const res = await submitQuizResponse({
          quizId: quiz.id,
          studentName: studentName || undefined,
          studentEmail: studentEmail || undefined,
          answers: stringKeyAnswers,
        });
        setResult(res);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'ATTEMPT_LIMIT_EXCEEDED') {
          setError('您已達到作答上限，無法再次提交。');
        } else {
          setError(`提交失敗：${msg || '未知錯誤'}，請再試一次`);
        }
      }
    });
  };

  // 倒數計時器
  useEffect(() => {
    if (timeLeft === null || result) {
      return;
    }
    if (timeLeft <= 0) {
      if (!autoSubmittedRef.current) {
        autoSubmittedRef.current = true;
        handleSubmit(true);
      }
      return;
    }
    const id = setTimeout(() => setTimeLeft(t => (t !== null ? t - 1 : null)), 1000);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, result]);

  // 快閃卡複習模式
  if (flashCardMode) {
    return (
      <FlashCard
        questions={displayQuestions}
        onExit={() => setFlashCardMode(false)}
      />
    );
  }

  // 錯題重做模式
  if (result && retryMode) {
    return (
      <RetryScreen
        wrongQuestions={retryQuestions}
        originalWrongCount={retryQuestions.length}
        onBack={() => setRetryMode(false)}
      />
    );
  }

  // 成績畫面
  if (result) {
    return (
      <ResultScreen
        result={result}
        questions={displayQuestions}
        answers={answers}
        showAnswers={quiz.showAnswers}
        onRetry={() => setRetryMode(true)}
      />
    );
  }

  // 作答畫面
  return (
    <div className="space-y-6">
      {/* 測驗標題 */}
      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold">{quiz.title}</h1>
          {timeLeft !== null && (
            <div className={`shrink-0 rounded-full px-3 py-1 font-mono text-sm font-semibold tabular-nums ${timeLeft <= 60 ? 'bg-red-100 text-red-700' : 'bg-muted text-muted-foreground'}`}>
              {String(Math.floor(timeLeft / 60)).padStart(2, '0')}
              :
              {String(timeLeft % 60).padStart(2, '0')}
            </div>
          )}
        </div>
        {quiz.description && (
          <p className="mt-2 text-sm text-muted-foreground">{quiz.description}</p>
        )}
        <p className="mt-3 text-sm text-muted-foreground">
          共
          {' '}
          {displayQuestions.length}
          {' '}
          題
          ·
          {' '}
          {displayQuestions.reduce((sum, q) => sum + q.points, 0)}
          {' '}
          分
          {quiz.allowedAttempts && (
            <>
              {' '}
              ·
              {' '}
              每人限作答
              {' '}
              {quiz.allowedAttempts}
              {' '}
              次
            </>
          )}
        </p>
        <button
          onClick={() => setFlashCardMode(true)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          🃏 複習模式
        </button>
      </div>

      {/* 學生資料（選填） */}
      <div className="rounded-lg border bg-card p-5">
        <p className="mb-3 text-sm font-medium">作答者資料（選填）</p>
        <div className="flex gap-3 max-sm:flex-col">
          <input
            value={studentName}
            onChange={e => setStudentName(e.target.value)}
            placeholder="姓名"
            className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
          />
          <input
            type="email"
            value={studentEmail}
            onChange={e => setStudentEmail(e.target.value)}
            placeholder="Email"
            className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
      </div>

      {/* 題目清單 */}
      {displayQuestions.map((question, index) => (
        <QuestionItem
          key={question.id}
          question={question}
          index={index}
          answer={answers[question.id]}
          onChange={value => handleAnswer(question.id, value)}
        />
      ))}

      {/* 錯誤訊息 + 提交 */}
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Button
        onClick={() => handleSubmit()}
        disabled={isPending}
        className="w-full"
        size="lg"
      >
        {isPending ? '提交中…' : '送出作答'}
      </Button>
    </div>
  );
}
