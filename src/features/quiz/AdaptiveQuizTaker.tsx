'use client';

/**
 * 自適應測驗（CAT）作答介面
 *
 * 流程：
 *   1. 進入時呼叫 /api/quiz/[id]/adaptive/next 拿第一題
 *   2. 學生作答 → 呼叫 /api/quiz/[id]/adaptive/grade 取得 isCorrect + 正解
 *   3. 顯示對錯回饋 → 學生點「下一題」→ 呼叫 next 拿下一題
 *   4. 直到 done = true → 顯示能力等級 + 百分位
 *
 * 適性測驗特性：
 *   - 不一次顯示所有題目，學生看不到剩多少題（避免「猜剩餘難度」）
 *   - 每題即時批改（與一般測驗 batch 批改不同）
 *   - 不寫入 response / answer 表（這是「能力檢測」而非「成績」）
 *   - 結果僅存在 sessionStorage，學生重整後重新測一次
 *
 * 不支援的題型：
 *   - speaking（口說題）— 適性測驗演算法依賴 isCorrect 二元結果，口說題給的是 0–100 分
 *   - short_answer — 同樣需要二元結果
 *   出題老師應僅放選擇 / 是非 / 排序 / 聽力題到適性題庫中
 */

import type { InferSelectModel } from 'drizzle-orm';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { questionSchema, quizSchema } from '@/models/Schema';

const RankingQuestion = dynamic(
  () => import('./RankingQuestion').then(m => m.RankingQuestion),
  { ssr: false, loading: () => <p className="text-sm text-muted-foreground">載入排序題…</p> },
);

type Quiz = InferSelectModel<typeof quizSchema>;
// 從 server 來的「下一題」資料：與 question 表結構相同，但移除 correctAnswers
type SafeQuestion = Omit<InferSelectModel<typeof questionSchema>, 'correctAnswers'>;

type HistoryItem = { questionId: number; isCorrect: boolean };

type AdaptiveResult = {
  ability: number;
  level: string;
  description: string;
  percentile: number;
  totalAnswered: number;
  reason: 'target' | 'pool' | 'converged';
  history: HistoryItem[];
};

const SESSION_KEY_PREFIX = 'qf-adaptive-';

export function AdaptiveQuizTaker({ quiz }: { quiz: Quiz }) {
  const [currentQ, setCurrentQ] = useState<SafeQuestion | null>(null);
  const [ability, setAbility] = useState(0);
  const [target] = useState(quiz.adaptiveTargetCount ?? 10);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [answer, setAnswer] = useState<string | string[] | undefined>();
  const [feedback, setFeedback] = useState<{ isCorrect: boolean; correctAnswers: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AdaptiveResult | null>(null);

  const sessionKey = `${SESSION_KEY_PREFIX}${quiz.id}`;

  const fetchNext = useCallback(async (currentHistory: HistoryItem[]) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/quiz/${quiz.id}/adaptive/next`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history: currentHistory }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? `${res.status}`);
      }
      if (json.done) {
        const finalResult: AdaptiveResult = {
          ability: json.ability,
          level: json.level,
          description: json.description,
          percentile: json.percentile,
          totalAnswered: json.totalAnswered,
          reason: json.reason,
          history: currentHistory,
        };
        setResult(finalResult);
        setCurrentQ(null);
        // 保存 session 結果（重整時可看歷史）
        try {
          sessionStorage.setItem(sessionKey, JSON.stringify(finalResult));
        } catch { /* sessionStorage 滿 / 隱身模式：靜默 */ }
      } else {
        setCurrentQ(json.question);
        setAbility(json.ability);
        setAnswer(undefined);
        setFeedback(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '無法取得題目';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [quiz.id, sessionKey]);

  // 啟動：先看 sessionStorage 是否有未完成的記錄，否則從零開始
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(sessionKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && Array.isArray(parsed.history) && parsed.ability !== undefined && parsed.level) {
          // 之前已完成過 → 直接顯示結果
          setResult(parsed as AdaptiveResult);
          setLoading(false);
          return;
        }
      }
    } catch { /* */ }
    fetchNext([]);
  }, [fetchNext, sessionKey]);

  const handleSubmitAnswer = async () => {
    if (!currentQ) {
      return;
    }
    if (answer === undefined || (Array.isArray(answer) && answer.length === 0)) {
      setError('請先選擇答案');
      return;
    }
    // 排序題：必須拖完所有選項
    if (currentQ.type === 'ranking') {
      const optsLen = currentQ.options?.length ?? 0;
      if (!Array.isArray(answer) || answer.length !== optsLen) {
        setError('請完成排序');
        return;
      }
    }

    setGrading(true);
    setError('');
    try {
      const res = await fetch(`/api/quiz/${quiz.id}/adaptive/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: currentQ.id, answer }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? `${res.status}`);
      }
      setFeedback({ isCorrect: json.isCorrect, correctAnswers: json.correctAnswers ?? [] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '批改失敗';
      setError(msg);
    } finally {
      setGrading(false);
    }
  };

  const handleNext = () => {
    if (!currentQ || !feedback) {
      return;
    }
    const nextHistory = [...history, { questionId: currentQ.id, isCorrect: feedback.isCorrect }];
    setHistory(nextHistory);
    fetchNext(nextHistory);
  };

  const handleRetake = () => {
    sessionStorage.removeItem(sessionKey);
    setResult(null);
    setHistory([]);
    setAnswer(undefined);
    setFeedback(null);
    fetchNext([]);
  };

  // ── 結果畫面 ──────────────────────────────────────────────
  if (result) {
    const stopReasonLabel: Record<AdaptiveResult['reason'], string> = {
      target: '已達目標題數',
      pool: '題庫已答完',
      converged: '能力已穩定收斂',
    };
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50 to-indigo-50 p-6 text-center shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-purple-600">適性測驗結果</p>
          <p className="mt-2 text-5xl font-bold text-purple-700">{result.level}</p>
          <p className="mt-3 text-sm text-gray-700">{result.description}</p>
          <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
            <Stat label="能力指數" value={result.ability.toFixed(2)} />
            <Stat label="百分位" value={`PR ${result.percentile}`} />
            <Stat label="作答題數" value={String(result.totalAnswered)} />
          </div>
          <p className="mt-4 text-xs text-gray-500">
            停止原因：
            {stopReasonLabel[result.reason]}
          </p>
        </div>

        <div className="flex justify-center gap-3">
          <Button variant="outline" onClick={handleRetake}>重新測驗</Button>
        </div>

        <p className="text-center text-xs text-gray-400">
          適性測驗結果不寫入正式成績，僅用於評估個人目前能力。
        </p>
      </div>
    );
  }

  // ── 載入中 / 錯誤 ────────────────────────────────────────
  if (loading) {
    return (
      <div className="rounded-xl border bg-white p-8 text-center text-sm text-muted-foreground">
        正在挑選下一題…
      </div>
    );
  }
  if (error && !currentQ) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
        ⚠️
        {' '}
        {error}
      </div>
    );
  }
  if (!currentQ) {
    return null;
  }

  // ── 作答畫面 ────────────────────────────────────────────
  const progressPercent = Math.min(100, Math.round((history.length / target) * 100));
  // 是非題沒 options 時補預設
  const TF_DEFAULTS = [{ id: 'tf-true', text: '正確' }, { id: 'tf-false', text: '錯誤' }];
  const options = currentQ.type === 'true_false' && (!currentQ.options || currentQ.options.length === 0)
    ? TF_DEFAULTS
    : (currentQ.options ?? []);

  return (
    <div className="space-y-5">
      {/* 頂部進度條（不顯示確切剩餘題數，避免猜難度） */}
      <div className="rounded-xl border bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            🧠 適性測驗進行中 · 已答
            {' '}
            <strong className="text-purple-700">{history.length}</strong>
            {' '}
            題
          </span>
          <span className="text-gray-400">能力依答題自動調整</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-purple-400 to-indigo-500 transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* 題目卡片 */}
      <div className="rounded-2xl border border-white/80 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-400 to-indigo-500 text-sm font-bold text-white shadow-sm">
            {history.length + 1}
          </span>
          <p className="text-base font-semibold leading-relaxed sm:text-lg">{currentQ.body}</p>
        </div>

        {currentQ.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={currentQ.imageUrl} alt="題目圖片" className="mb-4 max-h-[360px] w-full rounded-lg object-contain" />
        )}

        {currentQ.audioUrl && (
          <div className="mb-4 rounded-lg border bg-muted/30 p-3">
            <p className="mb-2 text-xs text-muted-foreground">🎧 請先聽完音檔再作答</p>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio controls src={currentQ.audioUrl} className="w-full" />
          </div>
        )}

        {/* 單選 / 是非 / 聽力 */}
        {(currentQ.type === 'single_choice' || currentQ.type === 'true_false' || currentQ.type === 'listening') && (
          <div className="space-y-1.5">
            {options.map(opt => (
              <button
                key={opt.id}
                type="button"
                onClick={() => !feedback && setAnswer(opt.id)}
                disabled={!!feedback}
                className={`flex w-full items-center gap-3 rounded-lg border-2 px-3 py-2 text-left transition-all ${
                  answer === opt.id
                    ? 'border-purple-400 bg-purple-50/80'
                    : 'border-gray-100 bg-gray-50/50 hover:border-gray-200'
                } ${feedback ? 'cursor-default opacity-90' : ''}`}
              >
                <span className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${
                  answer === opt.id ? 'border-purple-500 bg-purple-500' : 'border-gray-300'
                }`}
                >
                  {answer === opt.id && <span className="size-2 rounded-full bg-white" />}
                </span>
                <span className="text-base text-gray-800">{opt.text}</span>
                {feedback && feedback.correctAnswers.includes(opt.id) && (
                  <span className="ml-auto text-xs font-medium text-emerald-600">✓ 正解</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* 多選 */}
        {currentQ.type === 'multiple_choice' && (
          <div className="space-y-1.5">
            <p className="mb-1 text-xs text-gray-500">可複選</p>
            {options.map((opt) => {
              const checked = Array.isArray(answer) && answer.includes(opt.id);
              return (
                <label
                  key={opt.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border-2 px-3 py-2 transition-all ${
                    checked ? 'border-purple-400 bg-purple-50/80' : 'border-gray-100 bg-gray-50/50'
                  } ${feedback ? 'cursor-default opacity-90' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!!feedback}
                    onChange={(e) => {
                      const cur = Array.isArray(answer) ? answer : [];
                      setAnswer(e.target.checked ? [...cur, opt.id] : cur.filter(id => id !== opt.id));
                    }}
                    className="sr-only"
                  />
                  <span className={`flex size-5 shrink-0 items-center justify-center rounded border-2 ${
                    checked ? 'border-purple-500 bg-purple-500' : 'border-gray-300'
                  }`}
                  >
                    {checked && <span className="size-2 rounded-sm bg-white" />}
                  </span>
                  <span className="text-base text-gray-800">{opt.text}</span>
                  {feedback && feedback.correctAnswers.includes(opt.id) && (
                    <span className="ml-auto text-xs font-medium text-emerald-600">✓</span>
                  )}
                </label>
              );
            })}
          </div>
        )}

        {/* 排序題 */}
        {currentQ.type === 'ranking' && (
          <div className="pl-2">
            <p className="mb-2 text-xs text-muted-foreground">請拖曳排序</p>
            <RankingQuestion
              questionId={currentQ.id}
              options={options}
              value={Array.isArray(answer) ? answer : undefined}
              onChange={v => !feedback && setAnswer(v)}
            />
          </div>
        )}

        {/* 不支援的題型提示 */}
        {(currentQ.type === 'short_answer' || currentQ.type === 'speaking') && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            ⚠️ 適性測驗不支援
            {currentQ.type === 'short_answer' ? '簡答題' : '口說題'}
            ，跳過此題。
          </div>
        )}
      </div>

      {/* 即時批改回饋 */}
      {feedback && (
        <div className={`rounded-xl border-2 p-4 text-sm font-medium ${
          feedback.isCorrect
            ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
            : 'border-red-300 bg-red-50 text-red-800'
        }`}
        >
          {feedback.isCorrect ? '✓ 答對了！題目難度將自動上調' : '✗ 答錯了！下一題會稍微簡單一些'}
        </div>
      )}

      {/* 錯誤訊息 */}
      {error && currentQ && (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      {/* 操作按鈕 */}
      <div className="flex justify-end gap-2">
        {!feedback
          ? (
              <Button onClick={handleSubmitAnswer} disabled={grading || answer === undefined}>
                {grading ? '批改中…' : '送出答案'}
              </Button>
            )
          : (
              <Button onClick={handleNext} className="bg-purple-600 hover:bg-purple-700">
                下一題 →
              </Button>
            )}
      </div>

      {/* 隱藏 ability 不顯示給學生（避免分心 / 心態崩） */}
      {process.env.NODE_ENV === 'development' && (
        <p className="text-[10px] text-gray-300">
          [dev] θ ≈
          {' '}
          {ability.toFixed(2)}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/70 px-3 py-2 shadow-sm">
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-purple-700">{value}</p>
    </div>
  );
}
