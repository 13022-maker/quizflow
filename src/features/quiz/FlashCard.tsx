'use client';

import type { InferSelectModel } from 'drizzle-orm';
import { useCallback, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { questionSchema } from '@/models/Schema';

type Question = InferSelectModel<typeof questionSchema>;

// 是非題預設選項
const TF_DEFAULTS = [
  { id: 'tf-true', text: '正確' },
  { id: 'tf-false', text: '錯誤' },
];

function SpeakerButton({ text }: { text: string }) {
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleSpeak = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (loading) {
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/ai/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: 'zh-tw-female', speed: 'normal' }),
      });
      if (!res.ok) {
        throw new Error('TTS 失敗');
      }
      const { url } = await res.json();
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.play();
    } catch {
      // 靜默失敗
    } finally {
      setLoading(false);
    }
  }, [text, loading]);

  return (
    <button
      type="button"
      onClick={handleSpeak}
      className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-3 py-1.5 text-sm text-blue-600 transition-colors hover:bg-blue-100"
      title="朗讀發音"
    >
      {loading
        ? (
            <svg className="size-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )
        : (
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
            </svg>
          )}
      發音
    </button>
  );
}

/**
 * 快閃卡複習模式
 * 正面顯示題目，點擊翻牌顯示答案與解析
 */
export function FlashCard({
  questions,
  onExit,
}: {
  questions: Question[];
  onExit: () => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [knownIds, setKnownIds] = useState<Set<number>>(new Set());
  const [finished, setFinished] = useState(false);

  const question = questions[currentIndex]!;

  // 取得正確答案文字
  const getAnswerText = (q: Question): string => {
    const options = q.type === 'true_false' && (!q.options || q.options.length === 0)
      ? TF_DEFAULTS
      : (q.options ?? []);

    if (q.correctAnswers && q.correctAnswers.length > 0 && options.length > 0) {
      return q.correctAnswers
        .map(id => options.find(o => o.id === id)?.text ?? id)
        .join('、');
    }
    if (q.correctAnswers && q.correctAnswers.length > 0) {
      return q.correctAnswers.join('、');
    }
    return '（無標準答案）';
  };

  // 下一題
  const handleNext = (known: boolean) => {
    if (known) {
      setKnownIds(prev => new Set(prev).add(question.id));
    }

    if (currentIndex < questions.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setFlipped(false);
    } else {
      setFinished(true);
    }
  };

  // 重新開始
  const handleRestart = () => {
    setCurrentIndex(0);
    setFlipped(false);
    setKnownIds(new Set());
    setFinished(false);
  };

  // 完成畫面
  if (finished) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-4xl">🎉</p>
          <p className="mt-3 text-xl font-bold">全部複習完畢！</p>
          <p className="mt-2 text-sm text-muted-foreground">
            共
            {' '}
            {questions.length}
            {' '}
            題，你記住了
            {' '}
            {knownIds.size}
            {' '}
            題
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Button variant="outline" onClick={handleRestart}>
              重新開始
            </Button>
            <Button onClick={onExit}>
              返回測驗
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 進度列 */}
      <div className="flex items-center justify-between">
        <button
          onClick={onExit}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← 返回測驗
        </button>
        <span className="text-sm font-medium text-muted-foreground">
          {currentIndex + 1}
          {' '}
          /
          {questions.length}
        </span>
      </div>

      {/* 進度條 */}
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
        />
      </div>

      {/* 翻牌卡片 */}
      <div
        className="perspective-[800px] cursor-pointer"
        style={{ perspective: '800px' }}
        onClick={() => setFlipped(prev => !prev)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            setFlipped(prev => !prev);
          }
        }}
      >
        <div
          className="relative transition-transform duration-500"
          style={{
            transformStyle: 'preserve-3d',
            transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          }}
        >
          {/* 正面：題目 */}
          <div
            className="rounded-xl border bg-card p-8 shadow-sm"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              點擊翻牌看答案
            </p>

            {/* 題目圖片 */}
            {question.imageUrl && (
              <div className="mb-4 flex items-center justify-center overflow-hidden rounded-lg border border-[#e0e0e0] bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={question.imageUrl}
                  alt="題目圖片"
                  className="max-h-[200px] w-full object-contain"
                />
              </div>
            )}

            <p className="text-lg font-medium leading-relaxed">
              {question.body}
            </p>

            {/* 發音按鈕 */}
            <div className="mt-3">
              <SpeakerButton text={question.body} />
            </div>

            {/* 選項提示（選擇題時） */}
            {question.options && question.options.length > 0 && (
              <div className="mt-4 space-y-1">
                {(question.type === 'true_false' && question.options.length === 0
                  ? TF_DEFAULTS
                  : question.options
                ).map(opt => (
                  <p key={opt.id} className="text-sm text-muted-foreground">
                    {opt.text}
                  </p>
                ))}
              </div>
            )}
          </div>

          {/* 背面：答案 */}
          <div
            className="absolute inset-0 rounded-xl border bg-card p-8 shadow-sm"
            style={{
              backfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
            }}
          >
            <p className="mb-2 text-xs font-medium text-green-600">
              正確答案
            </p>
            <p className="text-lg font-bold text-green-700">
              {getAnswerText(question)}
            </p>
            <div className="mt-3">
              <SpeakerButton text={getAnswerText(question)} />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              點擊翻回正面
            </p>
          </div>
        </div>
      </div>

      {/* 底部按鈕 */}
      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1 border-red-200 text-red-600 hover:bg-red-50"
          onClick={(e) => {
            e.stopPropagation();
            handleNext(false);
          }}
        >
          不會
        </Button>
        <Button
          className="flex-1 bg-green-600 hover:bg-green-700"
          onClick={(e) => {
            e.stopPropagation();
            handleNext(true);
          }}
        >
          會了
        </Button>
      </div>
    </div>
  );
}
