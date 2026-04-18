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

// 補強題型別
type RemedialQuestion = {
  question: string;
  options: string[];
  answer: string;
  explanation: string;
  targetConcept: string;
};

// ── 家教模式：本機批改（與 server-side 邏輯一致） ───────────────
// 簡答題回傳 null（無法自動判對錯，只能顯示參考答案）
function gradeAnswer(question: Question, answer: string | string[] | undefined): boolean | null {
  if (question.type === 'short_answer') {
    return null;
  }
  if (!question.correctAnswers || answer === undefined) {
    return false;
  }
  if (question.type === 'single_choice' || question.type === 'true_false' || question.type === 'listening') {
    return question.correctAnswers.includes(answer as string);
  }
  if (question.type === 'multiple_choice') {
    const given = Array.isArray(answer) ? [...answer].sort() : [];
    const expected = [...question.correctAnswers].sort();
    return JSON.stringify(given) === JSON.stringify(expected);
  }
  if (question.type === 'ranking') {
    const given = Array.isArray(answer) ? answer : [];
    return JSON.stringify(given) === JSON.stringify(question.correctAnswers);
  }
  return false;
}

// 將 option id 陣列翻成顯示文字（家教模式呈現正解用）
function answerToText(question: Question, ids: string[] | null | undefined): string {
  if (!ids || ids.length === 0) {
    return '—';
  }
  const tfDefaults = [{ id: 'tf-true', text: '正確' }, { id: 'tf-false', text: '錯誤' }];
  const options = question.type === 'true_false' && (!question.options || question.options.length === 0)
    ? tfDefaults
    : (question.options ?? []);
  const sep = question.type === 'ranking' ? ' → ' : '、';
  return ids.map(id => options.find(o => o.id === id)?.text ?? id).join(sep);
}

// ── 個別題目元件 ─────────────────────────────────────────────────

type TutorState = {
  checked: boolean; // 是否已點「確認答案」
  correct: boolean | null; // 對錯（短答題 = null）
  onCheck: () => void;
  onReset: () => void;
};

function QuestionItem({
  question,
  index,
  answer,
  onChange,
  tutor,
}: {
  question: Question;
  index: number;
  answer: string | string[] | undefined;
  onChange: (value: string | string[]) => void;
  tutor?: TutorState;
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
    <div className="rounded-2xl border border-white/80 bg-white/90 p-6 shadow-sm backdrop-blur-sm">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-sm font-bold text-white shadow-sm">
          {index + 1}
        </span>
        <p className="text-base font-semibold leading-relaxed sm:text-lg">{question.body}</p>
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

      {/* 聽力題音檔播放器 */}
      {question.audioUrl && (
        <div className="mb-4 rounded-lg border bg-muted/30 p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">🎧 請先聽完音檔再作答</p>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls className="w-full" src={question.audioUrl}>
            你的瀏覽器不支援音訊播放
          </audio>
        </div>
      )}

      {/* 單選題 / 是非題 / 聽力題（聽力題選項邏輯等同單選） */}
      {(question.type === 'single_choice' || question.type === 'true_false' || question.type === 'listening') && (
        <div className="space-y-2.5">
          {options.map(opt => (
            <label
              key={opt.id}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-3.5 transition-all ${
                answer === opt.id
                  ? 'border-emerald-400 bg-emerald-50/80 shadow-sm'
                  : 'border-gray-100 bg-gray-50/50 hover:border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type="radio"
                name={`q-${question.id}`}
                value={opt.id}
                checked={answer === opt.id}
                onChange={() => handleSingleChange(opt.id)}
                className="sr-only"
              />
              <span className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                answer === opt.id
                  ? 'border-emerald-500 bg-emerald-500'
                  : 'border-gray-300'
              }`}>
                {answer === opt.id && (
                  <svg className="size-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                )}
              </span>
              <span className="text-base leading-relaxed text-gray-800">
                {opt.text}
              </span>
            </label>
          ))}
        </div>
      )}

      {/* 多選題 */}
      {question.type === 'multiple_choice' && (
        <div className="space-y-2.5">
          <p className="mb-1 text-sm text-gray-500">可選多個答案</p>
          {options.map((opt) => {
            const checked = Array.isArray(answer) && answer.includes(opt.id);
            return (
              <label
                key={opt.id}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-3.5 transition-all ${
                  checked
                    ? 'border-emerald-400 bg-emerald-50/80 shadow-sm'
                    : 'border-gray-100 bg-gray-50/50 hover:border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input
                  type="checkbox"
                  value={opt.id}
                  checked={checked}
                  onChange={e => handleMultiChange(opt.id, e.target.checked)}
                  className="sr-only"
                />
                <span className={`flex size-5 shrink-0 items-center justify-center rounded border-2 transition-all ${
                  checked ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300'
                }`}>
                  {checked && (
                    <svg className="size-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  )}
                </span>
                <span className="text-base leading-relaxed text-gray-800">{opt.text}</span>
              </label>
            );
          })}
        </div>
      )}

      {/* 簡答題 */}
      {question.type === 'short_answer' && (
        <textarea
          value={typeof answer === 'string' ? answer : ''}
          onChange={e => onChange(e.target.value)}
          rows={3}
          placeholder="請輸入你的答案..."
          className="w-full rounded-xl border-2 border-gray-100 bg-gray-50/50 px-4 py-3 text-base leading-relaxed text-gray-800 placeholder:text-gray-400 focus:border-emerald-400 focus:bg-white focus:outline-none"
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

      {/* 家教模式：確認按鈕 + 即時批改 feedback */}
      {tutor && (
        <div className="mt-4 border-t pt-4">
          {!tutor.checked
            ? (
                <button
                  type="button"
                  onClick={tutor.onCheck}
                  disabled={answer === undefined || (Array.isArray(answer) && answer.length === 0)}
                  className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  確認答案
                </button>
              )
            : (
                <div className="space-y-2">
                  {/* 短答題：只顯示參考答案，不判對錯 */}
                  {question.type === 'short_answer'
                    ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
                          <p className="font-medium text-amber-800">📝 短答題不自動批改</p>
                          {question.correctAnswers && question.correctAnswers.length > 0 && (
                            <p className="mt-1 text-amber-700">
                              <span className="font-medium">參考答案：</span>
                              {question.correctAnswers.join('、')}
                            </p>
                          )}
                        </div>
                      )
                    : tutor.correct
                      ? (
                          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
                            ✓ 答對了！
                          </div>
                        )
                      : (
                          <div className="space-y-1.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm">
                            <p className="font-medium text-red-700">✗ 答錯了</p>
                            <p className="text-foreground/80">
                              <span className="text-muted-foreground">正解：</span>
                              {answerToText(question, question.correctAnswers)}
                            </p>
                          </div>
                        )}
                  <button
                    type="button"
                    onClick={tutor.onReset}
                    className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                  >
                    再試一次
                  </button>
                </div>
              )}
        </div>
      )}
    </div>
  );
}

// ── 成績畫面（含 AI 弱點分析 + 錯題重做按鈕） ──────────────────

function ResultScreen({
  quizId,
  result,
  questions,
  answers,
  showAnswers,
  onRetry,
}: {
  quizId: number;
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

  // ── AI 助教提示（每題 ≤57 字解題提示） ──────────────────────
  // 獨立於 showAnswers：即使老師設定不顯示解答，仍顯示概念提示（57 字不洩答）
  const [hints, setHints] = useState<Record<number, string>>({});
  const [hintsLang, setHintsLang] = useState('zh-TW');
  const [hintsLoading, setHintsLoading] = useState(false);

  useEffect(() => {
    setHintsLoading(true);
    fetch(`/api/ai/generate-hints/${quizId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: hintsLang }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.hints) {
          setHints(data.hints);
        }
      })
      .catch(() => {})
      .finally(() => setHintsLoading(false));
  }, [quizId, hintsLang]);

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
      <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">作答完成</p>
        <p className="mt-3 text-5xl font-bold tabular-nums tracking-tight">
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
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-6">
          <h3 className="mb-4 font-semibold tracking-tight text-foreground">需要加強的概念</h3>
          {analysisLoading && (
            <p className="text-sm text-muted-foreground">AI 正在分析你的學習弱點…</p>
          )}
          {analysisError && (
            <p className="text-sm text-destructive">{analysisError}</p>
          )}
          {weakPoints !== null && weakPoints.length === 0 && (
            <p className="text-sm text-primary">太棒了！本次沒有答錯的題目。</p>
          )}
          {weakPoints && weakPoints.length > 0 && (
            <ul className="space-y-3">
              {weakPoints.map(wp => (
                <li key={wp.concept} className="rounded-lg bg-card px-4 py-3 text-sm shadow-sm">
                  <p className="font-medium text-foreground">{wp.concept}</p>
                  <p className="mt-0.5 text-muted-foreground">{wp.suggestion}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* AI 補強練習 */}
      {showAnswers && weakPoints && weakPoints.length > 0 && (
        <RemedialPractice weakPoints={weakPoints} responseId={result.responseId} />
      )}

      {/* AI 助教語系選擇 */}
      <div className="flex items-center justify-between rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2">
          <span className="text-lg" aria-hidden>💡</span>
          <span className="text-sm font-medium">AI 助教解析語言</span>
          {hintsLoading && <span className="text-xs text-muted-foreground">載入中…</span>}
        </div>
        <select
          value={hintsLang}
          onChange={e => setHintsLang(e.target.value)}
          className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="zh-TW">繁體中文</option>
          <option value="en">English</option>
          <option value="ja">日本語</option>
          <option value="ko">한국어</option>
          <option value="vi">Tiếng Việt</option>
          <option value="id">Bahasa Indonesia</option>
        </select>
      </div>

      {/* 逐題對照 + AI 助教提示
          正確答案跟老師 showAnswers 設定走；AI 助教提示獨立於 showAnswers 永遠顯示 */}
      <div className="space-y-3">
        {questions.map((question, index) => {
          const detail = result.details.find(d => d.questionId === question.id);
          const studentAnswer = answers[question.id];
          const tfDefaults = [{ id: 'tf-true', text: '正確' }, { id: 'tf-false', text: '錯誤' }];
          const options = question.type === 'true_false' && (!question.options || question.options.length === 0)
            ? tfDefaults
            : (question.options ?? []);
          const isShort = question.type === 'short_answer';

          // 只有 showAnswers 時才用對錯色，否則中性邊框
          const borderColor = !showAnswers
            ? ''
            : isShort
              ? ''
              : detail?.isCorrect
                ? 'border-green-300 bg-green-50/50'
                : 'border-red-300 bg-red-50/50';

          return (
            <div key={question.id} className={`rounded-xl border p-5 ${borderColor}`}>
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

              {/* 學生的答案 + 正解（皆受 showAnswers 控制） */}
              {showAnswers && (
                <>
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
                </>
              )}

              {/* AI 助教提示（獨立於 showAnswers，永遠顯示解題概念） */}
              {hints[question.id] && (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-xs font-semibold text-amber-800">💡 AI 助教</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-amber-900">
                    {hints[question.id]}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
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
        <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">錯題重做完成！</p>
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
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
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
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [studentName, setStudentName] = useState('');
  const [studentEmail, setStudentEmail] = useState('');

  const toggleFlag = (qId: number) => {
    setFlagged((prev) => {
      const next = new Set(prev);
      if (next.has(qId)) { next.delete(qId); } else { next.add(qId); }
      return next;
    });
  };

  const scrollToQuestion = (qId: number) => {
    document.getElementById(`q-${qId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const answeredCount = displayQuestions.filter((q) => {
    if (q.type === 'short_answer') return true;
    const ans = answers[q.id];
    if (q.type === 'ranking') return Array.isArray(ans) && ans.length === (q.options?.length ?? 0);
    return !!ans;
  }).length;

  const progressPercent = Math.round((answeredCount / displayQuestions.length) * 100);

  // 考試防作弊：離開頁面次數與警告等級
  // 防禦性預設：quiz.preventLeave 可能在舊資料中不存在
  const preventLeave = quiz.preventLeave ?? false;
  const [leaveCount, setLeaveCount] = useState(0);
  // 警告等級：null（無）/ 'warning'（1-2 次黃色）/ 'danger'（3+ 次紅色）
  const [leaveWarning, setLeaveWarning] = useState<'warning' | 'danger' | null>(null);
  // 用 ref 讀取最新 leaveCount，避免 visibilitychange handler 拿到過期閉包
  const leaveCountRef = useRef(0);

  // 快閃卡複習模式
  const [flashCardMode, setFlashCardMode] = useState(false);

  // 家教模式（即時批改、不送 server、不計成績）
  const [tutorMode, setTutorMode] = useState(false);
  const [tutorChecks, setTutorChecks] = useState<Record<number, boolean>>({});

  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  // ── 考試防作弊：離開頁面偵測 ─────────────────────────────────
  // 只在 preventLeave = true 且尚未送出作答時啟動
  useEffect(() => {
    if (!preventLeave || result) {
      return;
    }

    // beforeunload：攔截關閉分頁 / 重新整理 / 關閉瀏覽器
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '考試進行中，確定要離開？';
      return '考試進行中，確定要離開？';
    };

    // visibilitychange：偵測切換分頁 / 視窗失焦
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') {
        return;
      }
      const next = leaveCountRef.current + 1;
      leaveCountRef.current = next;
      setLeaveCount(next);
      setLeaveWarning(next >= 3 ? 'danger' : 'warning');
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [preventLeave, result]);

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
    setIsSubmitting(true);

    try {
      if (quiz.allowedAttempts && studentEmail) {
        const attemptCount = await checkAttemptCount(quiz.id, studentEmail);
        if (attemptCount >= quiz.allowedAttempts) {
          setError('您已達到作答上限，無法再次提交。');
          setIsSubmitting(false);
          return;
        }
      }

      const stringKeyAnswers: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(answers)) {
        stringKeyAnswers[String(key)] = value;
      }

      const res = await submitQuizResponse({
        quizId: quiz.id,
        studentName: studentName || undefined,
        studentEmail: studentEmail || undefined,
        answers: stringKeyAnswers,
        leaveCount: preventLeave ? leaveCountRef.current : undefined,
      });
      setResult(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'ATTEMPT_LIMIT_EXCEEDED') {
        setError('您已達到作答上限，無法再次提交。');
      } else {
        setError(`提交失敗：${msg || '未知錯誤'}，請再試一次`);
      }
    } finally {
      setIsSubmitting(false);
    }
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
        quizId={quiz.id}
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
      {/* 考試防作弊：離開頁面警告 banner */}
      {leaveWarning === 'warning' && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-3.5 text-sm text-amber-800">
          ⚠️ 偵測到你離開考試頁面，請專心作答
          {leaveCount > 1 && (
            <span className="ml-2 text-xs text-amber-700">
              （已離開
              {' '}
              {leaveCount}
              {' '}
              次）
            </span>
          )}
        </div>
      )}
      {leaveWarning === 'danger' && (
        <div className="rounded-xl border border-red-400 bg-red-50 px-5 py-3.5 text-sm font-medium text-red-800">
          🚨 多次離開頁面已被記錄，老師將會看到此記錄
          <span className="ml-2 text-xs text-red-700">
            （已離開
            {' '}
            {leaveCount}
            {' '}
            次）
          </span>
        </div>
      )}

      {/* 測驗標題 */}
      <div className="rounded-2xl border border-white/80 bg-white/90 p-6 shadow-sm backdrop-blur-sm">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{quiz.title}</h1>
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
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setFlashCardMode(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            🃏 複習模式
          </button>
          {/*
            家教模式按鈕暫時隱藏（保留 tutor logic 在下方，之後想啟用直接還原此區塊即可）
            <button
              type="button"
              onClick={() => {
                setTutorMode(true);
                setTutorChecks({});
                setError('');
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10"
            >
              🎓 家教模式
            </button>
          */}
        </div>
      </div>

      {/* 家教模式 banner（即時批改、不計成績） */}
      {tutorMode && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-primary">🎓 家教模式</p>
              <p className="mt-1 text-xs text-muted-foreground">
                每題作答後點「確認答案」即時看對錯與正解 · 此模式不計入成績
                {' · '}
                已完成
                {' '}
                {Object.values(tutorChecks).filter(Boolean).length}
                {' '}
                /
                {' '}
                {displayQuestions.length}
                {' '}
                題
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setTutorMode(false);
                setTutorChecks({});
              }}
              className="shrink-0 rounded-lg border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              結束家教模式
            </button>
          </div>
        </div>
      )}

      {/* 學生資料（選填）— 家教模式不顯示，因為不送 DB */}
      {!tutorMode && (
        <div className="rounded-xl border bg-card p-6">
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
      )}

      {/* ── 題目導覽面板 + 送出按鈕（頂部） ── */}
      <div className="sticky top-0 z-10 -mx-4 border-b bg-white/95 px-4 py-2.5 shadow-sm backdrop-blur-sm">
        {/* 進度 + 計時器 + 送出按鈕 */}
        <div className="mb-2 flex items-center gap-2">
          <div className="flex-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
          <span className="shrink-0 text-xs tabular-nums text-gray-500">{answeredCount}/{displayQuestions.length}</span>
          {timeLeft !== null && (
            <span className={`shrink-0 rounded px-2 py-0.5 font-mono text-xs font-bold tabular-nums ${
              timeLeft <= 60 ? 'bg-red-100 text-red-600 animate-pulse' : 'text-gray-500'
            }`}>
              {String(Math.floor(timeLeft / 60)).padStart(2, '0')}:{String(timeLeft % 60).padStart(2, '0')}
            </span>
          )}
          {!tutorMode && (
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={isSubmitting}
              className="shrink-0 rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-emerald-600 disabled:opacity-50"
            >
              {isSubmitting ? '提交中…' : '送出作答'}
            </button>
          )}
        </div>

        {/* 題號導覽列 */}
        <div className="flex flex-wrap gap-1">
          {displayQuestions.map((q, i) => {
            const isAnswered = q.type === 'short_answer' || !!answers[q.id];
            const isFlagged = flagged.has(q.id);
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => scrollToQuestion(q.id)}
                className={`relative flex size-6 items-center justify-center rounded text-[10px] font-bold transition-all ${
                  isFlagged
                    ? 'bg-amber-400 text-white'
                    : isAnswered
                      ? 'bg-emerald-500 text-white'
                      : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                }`}
              >
                {i + 1}
                {isFlagged && (
                  <span className="absolute -right-0.5 -top-0.5 text-[7px]">🚩</span>
                )}
              </button>
            );
          })}
        </div>

        {/* 錯誤訊息 */}
        {error && (
          <div className="mt-1.5 rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* 題目清單 */}
      {displayQuestions.map((question, index) => (
        <div key={question.id} id={`q-${question.id}`}>
        <QuestionItem
          question={question}
          index={index}
          answer={answers[question.id]}
          onChange={value => handleAnswer(question.id, value)}
          tutor={
            tutorMode
              ? {
                  checked: !!tutorChecks[question.id],
                  correct: tutorChecks[question.id]
                    ? gradeAnswer(question, answers[question.id])
                    : null,
                  onCheck: () => setTutorChecks(prev => ({ ...prev, [question.id]: true })),
                  onReset: () => setTutorChecks((prev) => {
                    const next = { ...prev };
                    delete next[question.id];
                    return next;
                  }),
                }
              : undefined
          }
        />
        <button
          type="button"
          onClick={() => toggleFlag(question.id)}
          className={`mt-1.5 flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs transition-colors ${
            flagged.has(question.id)
              ? 'bg-amber-100 text-amber-700'
              : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
          }`}
        >
          {flagged.has(question.id) ? '🚩 已標記複查' : '🏳️ 標記稍後複查'}
        </button>
        </div>
      ))}

    </div>
  );
}

// ── AI 補強練習元件 ──────────────────────────────────────────
function RemedialPractice({ weakPoints, responseId }: { weakPoints: WeakPoint[]; responseId: number }) {
  const [questions, setQuestions] = useState<RemedialQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    setQuestions([]);
    setAnswers({});
    setSubmitted(false);
    try {
      const res = await fetch('/api/ai/generate-remedial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weakPoints, responseId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setQuestions(data.questions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '補強題生成失敗');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => setSubmitted(true);

  const correctCount = questions.filter((q, i) => {
    const studentAns = answers[i];
    if (!studentAns) return false;
    return studentAns === q.answer;
  }).length;

  if (questions.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
        <p className="mb-2 text-base font-semibold text-amber-900">🎯 AI 補強練習</p>
        <p className="mb-4 text-sm text-amber-700">根據你的弱點，AI 會出幾題簡單的練習幫你打好基礎</p>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
        >
          {loading
            ? (
                <>
                  <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  生成補強題中…
                </>
              )
            : '開始補強練習'}
        </button>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/50 p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-amber-900">🎯 AI 補強練習</h3>
        {submitted && (
          <span className={`rounded-full px-3 py-1 text-sm font-bold ${
            correctCount === questions.length ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {correctCount}
            /
            {questions.length}
            {' '}
            題正確
          </span>
        )}
      </div>

      {questions.map((q, qi) => {
        const studentAns = answers[qi];
        const isCorrect = submitted && studentAns === q.answer;
        const isWrong = submitted && !!studentAns && studentAns !== q.answer;

        return (
          <div
            key={qi}
            className={`rounded-lg border bg-card p-5 ${
              isCorrect ? 'border-green-300' : isWrong ? 'border-red-300' : ''
            }`}
          >
            <p className="mb-1 text-xs text-amber-600">{q.targetConcept}</p>
            <p className="mb-3 text-base font-semibold leading-relaxed">{q.question}</p>

            <div className="space-y-2">
              {q.options.map((opt) => {
                const letter = opt.match(/^\(([A-D])\)/)?.[1] ?? '';
                const selected = studentAns === letter;
                const correct = submitted && letter === q.answer;
                const wrong = submitted && selected && letter !== q.answer;

                return (
                  <label
                    key={opt}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-base transition-colors ${
                      correct ? 'border-green-400 bg-green-50' : wrong ? 'border-red-400 bg-red-50' : selected ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted/50'
                    } ${submitted ? 'pointer-events-none' : ''}`}
                  >
                    <input
                      type="radio"
                      name={`remedial-${qi}`}
                      checked={selected}
                      onChange={() => setAnswers(prev => ({ ...prev, [qi]: letter }))}
                      disabled={submitted}
                      className="size-5 accent-primary"
                    />
                    <span>{opt}</span>
                    {correct && <span className="ml-auto text-green-600">✓</span>}
                    {wrong && <span className="ml-auto text-red-500">✗</span>}
                  </label>
                );
              })}
            </div>

            {submitted && (
              <div className="mt-3 rounded-lg bg-blue-50 px-4 py-3 text-sm leading-relaxed text-blue-800">
                <strong>解析：</strong>
                {q.explanation}
              </div>
            )}
          </div>
        );
      })}

      {!submitted
        ? (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={Object.keys(answers).length < questions.length}
              className="w-full rounded-lg bg-amber-500 py-3 text-sm font-bold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
            >
              {Object.keys(answers).length < questions.length
                ? `還有 ${questions.length - Object.keys(answers).length} 題未作答`
                : '送出補強練習'}
            </button>
          )
        : (
            <div className="text-center">
              <p className="mb-3 text-sm text-muted-foreground">
                {correctCount === questions.length
                  ? '全部答對！你已經掌握這些概念了 🎉'
                  : '繼續加油！可以再練習一次'}
              </p>
              <button
                type="button"
                onClick={handleGenerate}
                className="rounded-lg border border-amber-300 px-5 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100"
              >
                再練一組新題
              </button>
            </div>
          )}
    </div>
  );
}
