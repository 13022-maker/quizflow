'use client';

import type { InferSelectModel } from 'drizzle-orm';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { questionSchema, quizSchema } from '@/models/Schema';

type Quiz = InferSelectModel<typeof quizSchema>;
type Question = InferSelectModel<typeof questionSchema>;

type WordItem = {
  id: number;
  prompt: string; // 顯示給學生看的中文/提示
  answer: string; // 正確英文單字
  mistakes: number; // 這題累計錯誤次數
};

function pickAnswer(q: Question): string {
  const first = q.correctAnswers?.[0];
  if (typeof first === 'string' && first.trim().length > 0) {
    return first.trim();
  }
  return '';
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export function VocabTaker({ quiz, questions }: { quiz: Quiz; questions: Question[] }) {
  // 只取有正解的 short_answer 題目（其他題型忽略，保守 fallback）
  const initialQueue = useMemo<WordItem[]>(() => {
    const words = questions
      .map((q) => {
        const answer = pickAnswer(q);
        if (!answer) {
          return null;
        }
        return {
          id: q.id,
          prompt: q.body,
          answer,
          mistakes: 0,
        } as WordItem;
      })
      .filter((w): w is WordItem => w !== null);
    return shuffle(words);
  }, [questions]);

  const totalWords = initialQueue.length;
  const [queue, setQueue] = useState<WordItem[]>(initialQueue);
  const [mastered, setMastered] = useState<Set<number>>(new Set());
  const [input, setInput] = useState('');
  const [justFailed, setJustFailed] = useState<{ expected: string } | null>(null);
  const [totalAttempts, setTotalAttempts] = useState(0);
  const [totalMistakes, setTotalMistakes] = useState(0);
  const [done, setDone] = useState(initialQueue.length === 0);
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 計時器
  useEffect(() => {
    if (done) {
      return;
    }
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [done, startedAt]);

  // 每次切換題目自動 focus
  const current = queue[0];
  useEffect(() => {
    inputRef.current?.focus();
  }, [current?.id]);

  const goNext = useCallback(() => {
    setInput('');
    setJustFailed(null);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!current) {
      return;
    }
    const typed = input.trim();
    if (!typed) {
      return;
    }
    setTotalAttempts(n => n + 1);

    const isCorrect = typed.toLowerCase() === current.answer.toLowerCase();
    if (isCorrect) {
      // 過關：從佇列移除
      setMastered((prev) => {
        const next = new Set(prev);
        next.add(current.id);
        return next;
      });
      setQueue((q) => {
        const rest = q.slice(1);
        if (rest.length === 0) {
          setDone(true);
        }
        return rest;
      });
      goNext();
    } else {
      // 錯誤：顯示正解，並將該單字移到佇列尾端重練
      setTotalMistakes(n => n + 1);
      setJustFailed({ expected: current.answer });
      setQueue((q) => {
        if (q.length <= 1) {
          return q.map((w, i) => (i === 0 ? { ...w, mistakes: w.mistakes + 1 } : w));
        }
        const [head, ...rest] = q;
        const updated = { ...head!, mistakes: head!.mistakes + 1 };
        return [...rest, updated];
      });
      // 2 秒後自動切到下一題
      setTimeout(() => {
        setInput('');
        setJustFailed(null);
      }, 1800);
    }
  }, [current, input, goNext]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const progress = totalWords === 0 ? 0 : Math.round((mastered.size / totalWords) * 100);
  const accuracy = totalAttempts === 0 ? 0 : Math.round(((totalAttempts - totalMistakes) / totalAttempts) * 100);

  if (totalWords === 0) {
    return (
      <div className="rounded-xl border bg-white p-8 text-center shadow-sm">
        <p className="text-lg font-semibold">此單字記憶練習尚未加入題目</p>
        <p className="mt-2 text-sm text-muted-foreground">請聯絡老師補上單字。</p>
      </div>
    );
  }

  if (done) {
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    return (
      <div className="space-y-6 rounded-xl border bg-white p-8 text-center shadow-sm">
        <div className="text-6xl">🎉</div>
        <h2 className="text-2xl font-bold">全部過關！</h2>
        <p className="text-sm text-muted-foreground">{quiz.title}</p>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="rounded-lg bg-green-50 p-4">
            <p className="text-xs text-muted-foreground">單字數</p>
            <p className="text-2xl font-bold text-green-700">{totalWords}</p>
          </div>
          <div className="rounded-lg bg-blue-50 p-4">
            <p className="text-xs text-muted-foreground">正確率</p>
            <p className="text-2xl font-bold text-blue-700">
              {accuracy}
              %
            </p>
          </div>
          <div className="rounded-lg bg-amber-50 p-4">
            <p className="text-xs text-muted-foreground">耗時</p>
            <p className="text-2xl font-bold text-amber-700">
              {minutes}
              :
              {seconds.toString().padStart(2, '0')}
            </p>
          </div>
        </div>
        <Button
          onClick={() => {
            setQueue(shuffle(initialQueue));
            setMastered(new Set());
            setInput('');
            setJustFailed(null);
            setTotalAttempts(0);
            setTotalMistakes(0);
            setDone(false);
          }}
          size="lg"
          className="w-full"
        >
          再練一次
        </Button>
      </div>
    );
  }

  // 字元逐位比對著色（Qwerty Learner 風格）
  const letters = current!.answer.split('');
  const typedChars = input.split('');

  return (
    <div className="space-y-6">
      {/* 標題 + 進度 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-medium">{quiz.title}</span>
          <span>
            已過關
            {' '}
            {mastered.size}
            {' '}
            /
            {' '}
            {totalWords}
            {' '}
            · 佇列剩
            {queue.length}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-green-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* 中文提示卡 */}
      <div className="rounded-2xl border bg-white p-8 shadow-sm">
        <p className="mb-2 text-center text-xs uppercase tracking-widest text-muted-foreground">
          中文提示
        </p>
        <p className="text-center text-2xl font-semibold leading-relaxed text-foreground">
          {current!.prompt}
        </p>
        {current!.mistakes > 0 && (
          <p className="mt-3 text-center text-xs text-amber-600">
            ⚠️ 這個單字錯過
            {' '}
            {current!.mistakes}
            {' '}
            次，加油！
          </p>
        )}
      </div>

      {/* 逐字高亮顯示 */}
      <div className="flex justify-center">
        <div className="flex flex-wrap justify-center gap-1 font-mono text-2xl">
          {letters.map((letter, i) => {
            const typed = typedChars[i];
            let state: 'empty' | 'correct' | 'wrong' | 'current' = 'empty';
            if (justFailed) {
              state = 'wrong';
            } else if (typed !== undefined) {
              state = typed.toLowerCase() === letter.toLowerCase() ? 'correct' : 'wrong';
            } else if (i === typedChars.length) {
              state = 'current';
            }

            const baseCls = 'inline-flex size-10 items-center justify-center rounded-md border-2 transition-colors';
            const stateCls = {
              empty: 'border-transparent bg-muted/40 text-muted-foreground',
              correct: 'border-green-300 bg-green-50 text-green-700',
              wrong: 'border-red-300 bg-red-50 text-red-700',
              current: 'border-primary bg-primary/5 text-foreground animate-pulse',
            }[state];

            return (
              <span key={i} className={`${baseCls} ${stateCls}`}>
                {justFailed ? letter : (typed ?? (letter === ' ' ? '\u00A0' : '_'))}
              </span>
            );
          })}
        </div>
      </div>

      {/* 輸入框 */}
      <div className="mx-auto max-w-md">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!!justFailed}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={justFailed ? '正確答案如上，2 秒後繼續…' : '輸入英文後按 Enter'}
          className="w-full rounded-lg border-2 border-muted-foreground/20 bg-white px-4 py-3 text-center font-mono text-lg outline-none transition-colors focus:border-primary disabled:bg-red-50 disabled:text-red-700"
        />
        <p className="mt-2 text-center text-xs text-muted-foreground">
          按 Enter 送出 · 答錯會重新排入佇列
        </p>
      </div>

      {/* 即時統計 */}
      <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground">
        <span>
          嘗試
          {totalAttempts}
        </span>
        <span>
          錯誤
          {totalMistakes}
        </span>
        <span>
          正確率
          {accuracy}
          %
        </span>
      </div>
    </div>
  );
}
