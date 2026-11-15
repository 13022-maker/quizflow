'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { QuestionBody } from '@/components/quiz/QuestionBody';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { DEMO_QUIZ } from '@/data/demo/demoQuiz';
import { type DemoAnswers, type DemoQuestion, gradeDemoQuiz } from '@/libs/demoQuiz';

type Tab = 'teacher' | 'student';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * /demo 公開範例頁主體：
 * - 老師端：AI 出好的題目、正解、詳解、課綱 / Bloom 標籤
 * - 學生端：手機版作答畫面，交卷後本機批改（不寫 DB、不需登入）
 */
export function DemoQuizShowcase() {
  const t = useTranslations('Demo');
  const [tab, setTab] = useState<Tab>('teacher');

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16">
      {/* 分頁切換 */}
      <div role="tablist" aria-label={t('tabs_label')} className="mx-auto mb-8 flex w-fit gap-1 rounded-lg border bg-muted p-1">
        {(['teacher', 'student'] as const).map(key => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t(key === 'teacher' ? 'tab_teacher' : 'tab_student')}
          </button>
        ))}
      </div>

      {tab === 'teacher' ? <TeacherView /> : <StudentView />}

      {/* 底部 CTA：看完成果再註冊 */}
      <div className="mt-12 rounded-xl border bg-card p-8 text-center">
        <h2 className="text-xl font-semibold">{t('cta_title')}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t('cta_description')}</p>
        <a href="/sign-up" className={`${buttonVariants({ size: 'lg' })} mt-5`}>
          {t('cta_button')}
        </a>
      </div>
    </div>
  );
}

function TeacherView() {
  const t = useTranslations('Demo');

  return (
    <section aria-label={t('tab_teacher')}>
      {/* 模擬老師輸入的出題指令 */}
      <div className="mb-6 rounded-lg border bg-muted/50 p-4 text-sm">
        <span className="font-medium">{t('teacher_prompt_label')}</span>
        <span className="ml-2 text-muted-foreground">{DEMO_QUIZ.prompt}</span>
      </div>

      <h2 className="mb-1 text-lg font-semibold">{DEMO_QUIZ.title}</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        {t('teacher_meta', { count: DEMO_QUIZ.questions.length })}
      </p>

      <ol className="space-y-4">
        {DEMO_QUIZ.questions.map((q, i) => (
          <li key={q.id} className="rounded-lg border bg-card p-5">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-muted-foreground">
                Q
                {i + 1}
              </span>
              <Badge variant="outline">{t(`type_${q.type}`)}</Badge>
              {q.tags.map(tag => (
                <Badge key={tag} variant="secondary">{tag}</Badge>
              ))}
            </div>
            <QuestionBody text={q.body} className="font-medium" />
            <ul className="mt-3 space-y-1.5 text-sm">
              {q.options.map((opt, idx) => {
                const isAnswer = q.correctAnswers.includes(opt.id);
                return (
                  <li
                    key={opt.id}
                    className={`rounded-md px-3 py-1.5 ${isAnswer ? 'bg-green-50 font-medium text-green-800' : ''}`}
                  >
                    {q.type === 'true_false' ? opt.text : `(${LETTERS[idx]}) ${opt.text}`}
                    {isAnswer && <span className="ml-2">✓</span>}
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{t('explanation_label')}</span>
              {q.explanation}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function StudentView() {
  const t = useTranslations('Demo');
  const [answers, setAnswers] = useState<DemoAnswers>({});
  const [submitted, setSubmitted] = useState(false);

  const result = useMemo(
    () => (submitted ? gradeDemoQuiz(DEMO_QUIZ.questions, answers) : null),
    [submitted, answers],
  );

  const toggle = (q: DemoQuestion, optionId: string) => {
    if (submitted) {
      return;
    }
    setAnswers((prev) => {
      const current = prev[q.id] ?? [];
      if (q.type === 'multiple_choice') {
        const next = current.includes(optionId)
          ? current.filter(id => id !== optionId)
          : [...current, optionId];
        return { ...prev, [q.id]: next };
      }
      return { ...prev, [q.id]: [optionId] };
    });
  };

  const reset = () => {
    setAnswers({});
    setSubmitted(false);
  };

  return (
    <section aria-label={t('tab_student')}>
      <p className="mb-6 text-center text-sm text-muted-foreground">{t('student_intro')}</p>

      {/* 手機外框：讓老師想像學生掃 QR code 後看到的畫面 */}
      <div className="mx-auto max-w-sm rounded-[2rem] border-8 border-foreground/90 bg-background shadow-xl">
        <div className="max-h-[640px] overflow-y-auto p-4">
          <h2 className="mb-1 text-base font-semibold">{DEMO_QUIZ.title}</h2>
          <p className="mb-4 text-xs text-muted-foreground">{t('student_no_login')}</p>

          {result && (
            <div className="mb-4 rounded-lg bg-primary/10 p-4 text-center" role="status">
              <p className="text-3xl font-bold">
                {result.score}
                <span className="ml-1 text-base font-normal">{t('score_unit')}</span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('score_detail', { correct: result.correct, total: result.total })}
              </p>
            </div>
          )}

          <ol className="space-y-5">
            {DEMO_QUIZ.questions.map((q, i) => {
              const picked = answers[q.id] ?? [];
              const isCorrect = result?.results[q.id];
              return (
                <li key={q.id}>
                  <QuestionBody
                    text={q.body}
                    className="text-sm font-medium"
                    prefix={`${i + 1}. `}
                  />
                  {q.type === 'multiple_choice' && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{t('multi_hint')}</p>
                  )}
                  <div className="mt-2 space-y-1.5">
                    {q.options.map((opt) => {
                      const selected = picked.includes(opt.id);
                      const showCorrect = submitted && q.correctAnswers.includes(opt.id);
                      const showWrong = submitted && selected && !q.correctAnswers.includes(opt.id);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          disabled={submitted}
                          aria-pressed={selected}
                          onClick={() => toggle(q, opt.id)}
                          className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                            showCorrect
                              ? 'border-green-500 bg-green-50 text-green-800'
                              : showWrong
                                ? 'border-red-400 bg-red-50 text-red-700'
                                : selected
                                  ? 'border-primary bg-primary/10'
                                  : 'hover:bg-muted'
                          }`}
                        >
                          {opt.text}
                        </button>
                      );
                    })}
                  </div>
                  {submitted && (
                    <p className={`mt-2 text-xs ${isCorrect ? 'text-green-700' : 'text-red-600'}`}>
                      {isCorrect ? t('result_correct') : t('result_wrong')}
                      <span className="ml-1 text-muted-foreground">{q.explanation}</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ol>

          <div className="sticky bottom-0 mt-6 bg-background pt-2">
            {submitted
              ? (
                  <Button variant="outline" className="w-full" onClick={reset}>
                    {t('retry_button')}
                  </Button>
                )
              : (
                  <Button className="w-full" onClick={() => setSubmitted(true)}>
                    {t('submit_button')}
                  </Button>
                )}
          </div>
        </div>
      </div>
    </section>
  );
}
