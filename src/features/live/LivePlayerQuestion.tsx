'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useCountdown } from '@/hooks/useCountdown';
import { LISTENING_FALLBACK_SEC } from '@/services/live/questionDuration';
import type { LivePlayerState, LiveQuestionForPlayer } from '@/services/live/types';

type Props = {
  state: LivePlayerState;
  onSubmit: (questionId: number, selectedOptionId: string | string[]) => Promise<void>;
  submitting: boolean;
};

export function LivePlayerQuestion({ state, onSubmit, submitting }: Props) {
  const { currentQuestion, game, myAnswer, lastResult } = state;
  const { remaining, percent } = useCountdown(
    game.questionStartedAt,
    game.questionDuration,
  );

  // 單選 / 是非：string；複選：string[]
  const [selectedSingle, setSelectedSingle] = useState<string | null>(null);
  const [selectedMulti, setSelectedMulti] = useState<Set<string>>(new Set());

  // 聽力題播放狀態：'pending' 尚未判斷、'playing' 播放中（選項隱藏）、
  // 'blocked' 被瀏覽器擋自動播放（顯示手動播放按鈕）、'ended' 播完/late-join 判定已播完（顯示選項）
  const [audioState, setAudioState] = useState<'pending' | 'playing' | 'blocked' | 'ended'>('pending');

  // 換題清空選擇 + 重新判斷聽力題播放狀態
  const questionId = currentQuestion?.id ?? null;
  useEffect(() => {
    setSelectedSingle(null);
    setSelectedMulti(new Set());

    if (currentQuestion?.type !== 'listening') {
      setAudioState('ended'); // 非聽力題視同「已播完」，選項直接顯示
      return;
    }

    // 中途加入 / reconnect：若加入時音檔理論上已經播完，不重播，直接顯示選項
    // （避免卡在「聆聽中」畫面卻永遠聽不到已經播完的聲音）
    if (game.questionStartedAt) {
      const elapsedMs = Date.now() - new Date(game.questionStartedAt).getTime();
      const audioLenMs = (currentQuestion.audioDurationSec ?? LISTENING_FALLBACK_SEC) * 1000;
      if (elapsedMs >= audioLenMs) {
        setAudioState('ended');
        return;
      }
    }

    setAudioState('playing');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId]);

  if (!currentQuestion) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        載入題目中⋯
      </div>
    );
  }

  const isShowingResult = game.status === 'showing_result';
  const hasAnswered = !!myAnswer;
  const isMulti = currentQuestion.type === 'multiple_choice';

  const handleToggleMulti = (optId: string) => {
    const next = new Set(selectedMulti);
    if (next.has(optId)) {
      next.delete(optId);
    } else {
      next.add(optId);
    }
    setSelectedMulti(next);
  };

  const handleSubmit = async () => {
    if (isMulti) {
      if (selectedMulti.size === 0) {
        return;
      }
      await onSubmit(currentQuestion.id, Array.from(selectedMulti));
    } else {
      if (!selectedSingle) {
        return;
      }
      await onSubmit(currentQuestion.id, selectedSingle);
    }
  };

  const correctAnswers = lastResult?.correctAnswers ?? [];

  return (
    <div className="mx-auto max-w-xl space-y-5 px-4 py-6">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Q
          {game.currentQuestionIndex + 1}
          {' '}
          /
          {' '}
          {game.totalQuestions}
        </span>
        <span>
          你的分數：
          <strong className="text-foreground">{state.me.score}</strong>
        </span>
      </div>

      {/* 倒數 */}
      {!isShowingResult && (
        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">剩餘</span>
            <span className="font-mono font-bold">
              {remaining}
              s
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full transition-all ${
                percent > 75 ? 'bg-red-500' : percent > 50 ? 'bg-amber-400' : 'bg-primary'
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-card p-4">
        <h2 className="text-lg font-semibold leading-relaxed">
          {currentQuestion.body}
        </h2>
        {currentQuestion.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentQuestion.imageUrl}
            alt=""
            className="mt-3 max-h-60 rounded-lg"
          />
        )}
        {currentQuestion.type === 'listening' && currentQuestion.audioUrl && !isShowingResult && (
          <div className="mt-3">
            {audioState === 'playing' && (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <audio
                autoPlay
                src={currentQuestion.audioUrl}
                onEnded={() => setAudioState('ended')}
                onPlay={() => setAudioState('playing')}
                onError={() => setAudioState('ended')}
                ref={(el) => {
                  // autoplay 被瀏覽器政策擋下時 play() 會 reject，退回手動播放按鈕
                  el?.play().catch(() => setAudioState('blocked'));
                }}
              />
            )}
            {audioState === 'playing' && (
              <p className="text-center text-sm text-muted-foreground">🎧 聆聽中…</p>
            )}
            {audioState === 'blocked' && (
              <div className="text-center">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio
                  id={`listening-audio-${currentQuestion.id}`}
                  src={currentQuestion.audioUrl}
                  onEnded={() => setAudioState('ended')}
                  className="hidden"
                />
                <Button
                  type="button"
                  onClick={() => {
                    const el = document.getElementById(`listening-audio-${currentQuestion.id}`) as HTMLAudioElement | null;
                    el?.play();
                    setAudioState('playing');
                  }}
                >
                  ▶️ 點我播放音檔
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 選項：聽力題要等音檔播完（或已判定播完）才顯示，避免用猜的搶快 */}
      {audioState !== 'playing' && audioState !== 'blocked' && (
        <PlayerOptionList
          question={currentQuestion}
          selectedSingle={selectedSingle}
          selectedMulti={selectedMulti}
          myAnswerIds={myAnswerIds(myAnswer?.selectedOptionId)}
          correctAnswers={isShowingResult ? correctAnswers : undefined}
          disabled={hasAnswered || isShowingResult || submitting}
          onSelectSingle={setSelectedSingle}
          onToggleMulti={handleToggleMulti}
        />
      )}

      {/* 提交 / 狀態 */}
      {!isShowingResult && !hasAnswered && (
        <Button
          size="lg"
          className="w-full"
          onClick={handleSubmit}
          disabled={
            submitting
            || (isMulti ? selectedMulti.size === 0 : !selectedSingle)
          }
        >
          {submitting ? '送出中⋯' : '送出答案'}
        </Button>
      )}
      {hasAnswered && !isShowingResult && (
        <p className="text-center text-sm text-muted-foreground">
          已送出，等待其他玩家⋯
        </p>
      )}
      {isShowingResult && myAnswer && (
        <div
          className={`rounded-xl p-4 text-center ${
            myAnswer.isCorrect
              ? 'bg-green-50 text-green-800'
              : 'bg-red-50 text-red-800'
          }`}
        >
          <p className="text-lg font-semibold">
            {myAnswer.isCorrect ? '✅ 答對了！' : '❌ 答錯了'}
          </p>
          {myAnswer.isCorrect && (
            <p className="text-sm">
              +
              {myAnswer.score}
              {' '}
              分
            </p>
          )}
        </div>
      )}
      {isShowingResult && !myAnswer && (
        <div className="rounded-xl bg-muted p-4 text-center text-sm text-muted-foreground">
          ⏱ 逾時作答不計分
        </div>
      )}
    </div>
  );
}

function myAnswerIds(selected: string | string[] | null | undefined): Set<string> {
  if (!selected) {
    return new Set();
  }
  if (Array.isArray(selected)) {
    return new Set(selected);
  }
  return new Set([selected]);
}

function PlayerOptionList({
  question,
  selectedSingle,
  selectedMulti,
  myAnswerIds: mySelected,
  correctAnswers,
  disabled,
  onSelectSingle,
  onToggleMulti,
}: {
  question: LiveQuestionForPlayer;
  selectedSingle: string | null;
  selectedMulti: Set<string>;
  myAnswerIds: Set<string>;
  correctAnswers?: string[];
  disabled: boolean;
  onSelectSingle: (id: string) => void;
  onToggleMulti: (id: string) => void;
}) {
  const isMulti = question.type === 'multiple_choice';
  return (
    <div className="space-y-2">
      {question.options.map((opt, i) => {
        const picked = isMulti ? selectedMulti.has(opt.id) : selectedSingle === opt.id;
        const wasMyAnswer = mySelected.has(opt.id);
        const isCorrect = correctAnswers?.includes(opt.id) ?? false;
        const showingResult = !!correctAnswers;

        let className = 'border-2 border-border bg-card hover:border-primary/40';
        if (showingResult) {
          if (isCorrect) {
            className = 'border-2 border-green-500 bg-green-50';
          } else if (wasMyAnswer) {
            className = 'border-2 border-red-400 bg-red-50';
          } else {
            className = 'border-2 border-border bg-card opacity-60';
          }
        } else if (picked) {
          className = 'border-2 border-primary bg-primary/10';
        }

        return (
          <button
            key={opt.id}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (isMulti) {
                onToggleMulti(opt.id);
              } else {
                onSelectSingle(opt.id);
              }
            }}
            className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors disabled:cursor-not-allowed ${className}`}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold">
              {String.fromCharCode(65 + i)}
            </span>
            <span className="flex-1 text-sm">
              {opt.text}
            </span>
            {showingResult && isCorrect && <span>✓</span>}
            {showingResult && !isCorrect && wasMyAnswer && <span>✗</span>}
          </button>
        );
      })}
    </div>
  );
}
