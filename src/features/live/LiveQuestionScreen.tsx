'use client';

import { Button } from '@/components/ui/button';
import { useCountdown } from '@/hooks/useCountdown';
import type { LiveHostState } from '@/services/live/types';

import { LiveResultChart } from './LiveResultChart';

type Props = {
  state: LiveHostState;
  skew: number;
  onRevealResult: () => void;
  onNext: () => void;
  pending: boolean;
};

export function LiveQuestionScreen({
  state,
  skew,
  onRevealResult,
  onNext,
  pending,
}: Props) {
  const { currentQuestion, game, answerStats, answeredCount, players } = state;
  const { remaining, percent } = useCountdown({
    endsAt: game.questionEndsAt ? new Date(game.questionEndsAt).getTime() : null,
    skew,
    durationMs: game.questionDuration * 1000,
  });

  if (!currentQuestion) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        載入題目中⋯
      </div>
    );
  }

  const isShowingResult = game.status === 'showing_result';
  const isLocked = game.status === 'locked';
  const isLastQuestion = game.currentQuestionIndex >= game.totalQuestions - 1;

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-8">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          第
          {' '}
          {game.currentQuestionIndex + 1}
          {' '}
          /
          {' '}
          {game.totalQuestions}
          {' '}
          題
        </span>
        <span>
          {answeredCount}
          {' '}
          /
          {' '}
          {players.length}
          {' '}
          人已答
        </span>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <h2 className="text-xl font-semibold leading-relaxed">
          {currentQuestion.body}
        </h2>
        {currentQuestion.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentQuestion.imageUrl}
            alt=""
            className="mt-4 max-h-72 rounded-lg"
          />
        )}
      </div>

      {/* 倒數進度條（playing 才顯示；locked 顯示「時間到」） */}
      {!isShowingResult && !isLocked && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">剩餘時間</span>
            <span className="font-mono text-lg font-bold">
              {remaining}
              s
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full transition-all ${
                percent > 75 ? 'bg-red-500' : percent > 50 ? 'bg-amber-400' : 'bg-primary'
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}
      {isLocked && (
        <div className="rounded-lg bg-amber-50 px-4 py-2 text-center text-sm font-medium text-amber-800">
          ⏱ 時間到，按下「顯示答案」公布結果
        </div>
      )}

      {/* 選項顯示（老師端一律顯示答題分布） */}
      <LiveResultChart
        options={currentQuestion.options}
        stats={answerStats}
        correctAnswers={isShowingResult ? currentQuestion.correctAnswers : undefined}
      />

      <div className="flex justify-center gap-3">
        {!isShowingResult
          ? (
              <Button size="lg" onClick={onRevealResult} disabled={pending}>
                顯示答案
              </Button>
            )
          : (
              <Button size="lg" onClick={onNext} disabled={pending}>
                {isLastQuestion ? '顯示排行榜' : '下一題'}
              </Button>
            )}
      </div>
    </div>
  );
}
