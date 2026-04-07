'use client';

import type { InferSelectModel } from 'drizzle-orm';
import { useEffect, useRef, useState, useTransition } from 'react';

import type { SubmitResult } from '@/actions/responseActions';
import { checkAttemptCount, submitQuizResponse } from '@/actions/responseActions';
import { Button } from '@/components/ui/button';
import type { questionSchema, quizSchema } from '@/models/Schema';

type Quiz = InferSelectModel<typeof quizSchema>;
type Question = InferSelectModel<typeof questionSchema>;

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
  const options = question.options ?? [];

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
    </div>
  );
}

// ── 成績畫面 ─────────────────────────────────────────────────────

function ResultScreen({
  result,
  questions,
  answers,
  showAnswers,
}: {
  result: SubmitResult;
  questions: Question[];
  answers: Record<number, string | string[]>;
  showAnswers: boolean;
}) {
  const percentage = result.totalPoints > 0
    ? Math.round((result.score / result.totalPoints) * 100)
    : 0;

  const hasShortAnswer = questions.some(q => q.type === 'short_answer');

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
      </div>

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
            const options = question.options ?? [];
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
                      .join('、')
                    : typeof studentAnswer === 'string'
                      ? (options.find(o => o.id === studentAnswer)?.text ?? studentAnswer) || (
                          <span className="italic text-muted-foreground">未作答</span>
                        )
                      : <span className="italic text-muted-foreground">未作答</span>}
                </div>

                {/* 正確答案（非簡答題） */}
                {!isShort && detail?.isCorrect === false && question.correctAnswers && (
                  <div className="mt-1 text-sm text-green-700">
                    <span className="text-muted-foreground">正確答案：</span>
                    {question.correctAnswers
                      .map(id => options.find(o => o.id === id)?.text ?? id)
                      .join('、')}
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
  // 隨機排序只在掛載時執行一次（用 useState initializer 避免重新渲染時重洗）
  const [displayQuestions] = useState<Question[]>(() => {
    const ordered = quiz.shuffleQuestions ? shuffle(questions) : questions;
    if (!quiz.shuffleOptions) {
      return ordered;
    }
    return ordered.map(q =>
      q.options ? { ...q, options: shuffle(q.options) } : q,
    );
  });

  const [answers, setAnswers] = useState<Record<number, string | string[]>>({});
  const [studentName, setStudentName] = useState('');
  const [studentEmail, setStudentEmail] = useState('');
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  // 倒數計時器（timeLimitSeconds 有值時啟動）
  const [timeLeft, setTimeLeft] = useState<number | null>(quiz.timeLimitSeconds ?? null);
  const autoSubmittedRef = useRef(false); // 防止計時結束後重複送出

  const handleAnswer = (questionId: number, value: string | string[]) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  // skipValidation = true 時為計時結束自動送出，跳過未作答檢查
  const handleSubmit = (skipValidation = false) => {
    if (!skipValidation) {
      const unanswered = displayQuestions.filter(
        q => q.type !== 'short_answer' && !answers[q.id],
      );
      if (unanswered.length > 0) {
        setError(`還有 ${unanswered.length} 題未作答`);
        return;
      }
    }
    setError('');

    startTransition(async () => {
      try {
        // 作答次數 client-side 預檢（有 email 且測驗有限制時）
        if (quiz.allowedAttempts && studentEmail) {
          const attemptCount = await checkAttemptCount(quiz.id, studentEmail);
          if (attemptCount >= quiz.allowedAttempts) {
            setError('您已達到作答上限，無法再次提交。');
            return;
          }
        }
        const res = await submitQuizResponse({
          quizId: quiz.id,
          studentName: studentName || undefined,
          studentEmail: studentEmail || undefined,
          answers: Object.fromEntries(Object.entries(answers)),
        });
        setResult(res);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg === 'ATTEMPT_LIMIT_EXCEEDED') {
          setError('您已達到作答上限，無法再次提交。');
        } else {
          setError('提交失敗，請再試一次');
        }
      }
    });
  };

  // 倒數計時器：每秒遞減，歸零時自動送出
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

  // 已提交 → 顯示成績（傳 displayQuestions，確保選項文字對應正確）
  if (result) {
    return (
      <ResultScreen
        result={result}
        questions={displayQuestions}
        answers={answers}
        showAnswers={quiz.showAnswers}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* 測驗標題 */}
      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold">{quiz.title}</h1>
          {/* 倒數計時器（有限時才顯示） */}
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
      </div>

      {/* 學生資料（可選填） */}
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
