'use client';

import type { InferSelectModel } from 'drizzle-orm';
import { useState, useTransition } from 'react';

import { submitQuizResponse } from '@/actions/responseActions';
import type { SubmitResult } from '@/actions/responseActions';
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
}: {
  result: SubmitResult;
  questions: Question[];
  answers: Record<number, string | string[]>;
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

      {/* 逐題對照 */}
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
                <p className="font-medium text-sm">
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
                        <span className="text-muted-foreground italic">未作答</span>
                      )
                    : <span className="text-muted-foreground italic">未作答</span>}
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
    </div>
  );
}

// ── 主元件 ────────────────────────────────────────────────────────

export function QuizTaker({ quiz, questions }: { quiz: Quiz; questions: Question[] }) {
  const [answers, setAnswers] = useState<Record<number, string | string[]>>({});
  const [studentName, setStudentName] = useState('');
  const [studentEmail, setStudentEmail] = useState('');
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleAnswer = (questionId: number, value: string | string[]) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  const handleSubmit = () => {
    // 確認所有非簡答題都已作答
    const unanswered = questions.filter(
      q => q.type !== 'short_answer' && !answers[q.id],
    );
    if (unanswered.length > 0) {
      setError(`還有 ${unanswered.length} 題未作答`);
      return;
    }
    setError('');

    startTransition(async () => {
      try {
        const res = await submitQuizResponse({
          quizId: quiz.id,
          studentName: studentName || undefined,
          studentEmail: studentEmail || undefined,
          answers: Object.fromEntries(
            Object.entries(answers).map(([k, v]) => [k, v]),
          ),
        });
        setResult(res);
      } catch {
        setError('提交失敗，請再試一次');
      }
    });
  };

  // 已提交 → 顯示成績
  if (result) {
    return (
      <ResultScreen
        result={result}
        questions={questions}
        answers={answers}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* 測驗標題 */}
      <div className="rounded-lg border bg-card p-5">
        <h1 className="text-2xl font-bold">{quiz.title}</h1>
        {quiz.description && (
          <p className="mt-2 text-sm text-muted-foreground">{quiz.description}</p>
        )}
        <p className="mt-3 text-sm text-muted-foreground">
          共
          {' '}
          {questions.length}
          {' '}
          題
          ·
          {' '}
          {questions.reduce((sum, q) => sum + q.points, 0)}
          {' '}
          分
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
      {questions.map((question, index) => (
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
        onClick={handleSubmit}
        disabled={isPending}
        className="w-full"
        size="lg"
      >
        {isPending ? '提交中…' : '送出作答'}
      </Button>
    </div>
  );
}
