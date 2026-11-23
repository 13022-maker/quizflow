'use client';

import { useState } from 'react';

import type { LearnQuestion } from '@/content/learn';

type Props = {
  questions: LearnQuestion[];
};

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

// 公開練習頁的免登入作答：全部在瀏覽器端批改，不寫資料庫
export function LearnPractice({ questions }: Props) {
  const [answers, setAnswers] = useState<(number | null)[]>(() => questions.map(() => null));
  const [submitted, setSubmitted] = useState(false);

  const answeredCount = answers.filter(a => a !== null).length;
  const correctCount = answers.filter((a, i) => a === questions[i]?.answer).length;

  const choose = (qi: number, oi: number) => {
    if (submitted) {
      return;
    }
    setAnswers(prev => prev.map((a, i) => (i === qi ? oi : a)));
  };

  const reset = () => {
    setAnswers(questions.map(() => null));
    setSubmitted(false);
  };

  return (
    <div className="space-y-5">
      {submitted && (
        <div
          role="status"
          className="rounded-2xl border border-primary/30 bg-primary/5 p-5 text-center"
        >
          <p className="text-sm text-muted-foreground">你的成績</p>
          <p className="mt-1 text-3xl font-bold text-primary">
            {correctCount}
            {' / '}
            {questions.length}
          </p>
          <p className="mt-1 text-sm text-foreground/80">
            {correctCount === questions.length
              ? '全對！這個單元你已經很熟了。'
              : '往下看每題詳解，把錯的觀念補起來再挑戰一次。'}
          </p>
        </div>
      )}

      {questions.map((q, qi) => {
        const picked = answers[qi];
        const isCorrect = picked === q.answer;
        return (
          <fieldset key={qi} className="rounded-2xl border bg-card p-5 shadow-sm">
            <legend className="sr-only">
              第
              {qi + 1}
              題
            </legend>
            <p className="text-base font-medium">
              <span className="mr-2 text-muted-foreground">
                {qi + 1}
                .
              </span>
              {q.question}
            </p>
            <div className="mt-3 grid gap-2">
              {q.options.map((opt, oi) => {
                const selected = picked === oi;
                let tone = 'border-border hover:bg-muted';
                if (submitted && oi === q.answer) {
                  tone = 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100';
                } else if (submitted && selected) {
                  tone = 'border-rose-500 bg-rose-50 text-rose-900 dark:bg-rose-950 dark:text-rose-100';
                } else if (selected) {
                  tone = 'border-primary bg-primary/10';
                }
                return (
                  <button
                    key={oi}
                    type="button"
                    aria-pressed={selected}
                    disabled={submitted}
                    onClick={() => choose(qi, oi)}
                    className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default ${tone}`}
                  >
                    <span className="font-semibold text-muted-foreground">
                      {LETTERS[oi]}
                      .
                    </span>
                    <span>{opt}</span>
                  </button>
                );
              })}
            </div>

            {submitted && (
              <div className="mt-4 rounded-lg bg-muted/40 p-3 text-sm">
                <p className={isCorrect ? 'font-semibold text-emerald-700 dark:text-emerald-400' : 'font-semibold text-rose-700 dark:text-rose-400'}>
                  {picked === null ? '未作答' : isCorrect ? '答對 ✓' : '答錯 ✗'}
                  {!isCorrect && `，正解是 ${LETTERS[q.answer]}`}
                </p>
                <p className="mt-1 text-foreground/80">
                  <span className="font-semibold">詳解：</span>
                  {q.explanation}
                </p>
              </div>
            )}
          </fieldset>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          已作答
          {' '}
          {answeredCount}
          {' / '}
          {questions.length}
          {' '}
          題
        </p>
        {submitted
          ? (
              <button
                type="button"
                onClick={reset}
                className="rounded-lg border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
              >
                重新作答
              </button>
            )
          : (
              <button
                type="button"
                onClick={() => setSubmitted(true)}
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                交卷看成績
              </button>
            )}
      </div>
    </div>
  );
}
