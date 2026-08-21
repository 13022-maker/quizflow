'use client';

import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useCountdown } from '@/hooks/useCountdown';
import { LISTENING_FALLBACK_SEC } from '@/services/live/questionDuration';
import type { LivePlayerState, LiveQuestionForPlayer } from '@/services/live/types';

type Props = {
  state: LivePlayerState;
  onSubmit: (questionId: number, selectedOptionId: string | string[]) => Promise<void>;
  submitting: boolean;
};

// 判斷聽力題目前該進入哪個播放狀態，以及（中途加入時）該 seek 到第幾秒。
// 回傳 seekSec 是因為「中途加入時要從已過秒數接著播，而不是從頭重播」——
// 否則遲加入的學生實際聽完音檔的時間點會超過作答截止時間，嚴重時完全來不及作答。
function determineInitialAudioState(
  question: LiveQuestionForPlayer | null,
  questionStartedAtIso: string | null,
): { audioState: 'playing' | 'ended'; seekSec: number } {
  if (!question || question.type !== 'listening' || !question.audioUrl) {
    // 非聽力題、或聽力題但沒有音檔（例如老師忘了上傳）：視同已播完，選項直接顯示，
    // 不要卡在等待一個不存在的 <audio> 觸發 onEnded
    return { audioState: 'ended', seekSec: 0 };
  }
  if (questionStartedAtIso) {
    const elapsedMs = Date.now() - new Date(questionStartedAtIso).getTime();
    const audioLenMs = (question.audioDurationSec ?? LISTENING_FALLBACK_SEC) * 1000;
    if (elapsedMs >= audioLenMs) {
      // 中途加入時音檔理論上已經播完，不重播，直接顯示選項
      return { audioState: 'ended', seekSec: 0 };
    }
    // 中途加入但音檔還沒播完：seek 到已過秒數接著播，讓所有學生的音檔
    // 在同一個絕對時間點（questionStartedAt + 音檔長度）結束
    return { audioState: 'playing', seekSec: Math.max(0, elapsedMs / 1000) };
  }
  return { audioState: 'playing', seekSec: 0 };
}

export function LivePlayerQuestion({ state, onSubmit, submitting }: Props) {
  const { currentQuestion, game, myAnswer, lastResult } = state;
  const { remaining, percent } = useCountdown(
    game.questionStartedAt,
    game.questionDuration,
  );

  // 單選 / 是非：string；複選：string[]
  const [selectedSingle, setSelectedSingle] = useState<string | null>(null);
  const [selectedMulti, setSelectedMulti] = useState<Set<string>>(new Set());

  // 聽力題播放狀態：'playing' 播放中（選項隱藏）、
  // 'blocked' 被瀏覽器擋自動播放（顯示手動播放按鈕）、'ended' 播完/late-join 判定已播完（顯示選項）
  // 用 lazy init 直接算好初始值，避免掛載當下先閃一次選項才被 effect 蓋掉
  const [audioState, setAudioState] = useState<'playing' | 'blocked' | 'ended'>(
    () => determineInitialAudioState(currentQuestion, game.questionStartedAt).audioState,
  );
  // 中途加入時要 seek 到的秒數（隨換題更新，不用 state 是因為不影響渲染，純粹給 play 前讀取）
  const seekSecRef = useRef(
    determineInitialAudioState(currentQuestion, game.questionStartedAt).seekSec,
  );
  // 音檔元素：整題只掛一次，不因為 audioState 在 'playing'/'blocked' 之間切換而卸載重建——
  // 卸載重建會讓待處理的 play() promise 被 reject，手動播放按鈕在 iOS Safari 上可能完全沒反應
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 換題清空選擇 + 重新判斷聽力題播放狀態
  const questionId = currentQuestion?.id ?? null;
  useEffect(() => {
    setSelectedSingle(null);
    setSelectedMulti(new Set());

    const { audioState: nextAudioState, seekSec } = determineInitialAudioState(currentQuestion, game.questionStartedAt);
    seekSecRef.current = seekSec;
    setAudioState(nextAudioState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId]);

  // 實際觸發播放：只在 audioState 變成 'playing' 時執行一次，不受倒數計時器
  // 每 100ms re-render 影響（audioRef 是穩定的 ref 物件，不會每次 render 重新觸發）
  useEffect(() => {
    if (audioState !== 'playing') {
      return;
    }
    const el = audioRef.current;
    if (!el) {
      return;
    }
    el.currentTime = seekSecRef.current;
    el.play().catch(() => setAudioState('blocked')); // autoplay 被瀏覽器政策擋下時退回手動播放按鈕
  }, [audioState, questionId]);

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
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio
              ref={audioRef}
              src={currentQuestion.audioUrl}
              onEnded={() => setAudioState('ended')}
              onError={() => setAudioState('ended')}
              className="hidden"
            />
            {audioState === 'playing' && (
              <p className="text-center text-sm text-muted-foreground">🎧 聆聽中…</p>
            )}
            {audioState === 'blocked' && (
              <div className="text-center">
                <Button
                  type="button"
                  onClick={() => {
                    // 直接在使用者手勢的呼叫堆疊內同步呼叫 play()（不透過 effect），
                    // 避免嚴格瀏覽器（如 iOS Safari）判定「不是使用者手勢直接觸發」又被擋一次
                    const el = audioRef.current;
                    if (el) {
                      el.currentTime = seekSecRef.current;
                      el.play().catch(() => {
                        // 連使用者手勢觸發都還被擋（極罕見），維持 blocked 狀態，按鈕還在，可以再按一次
                      });
                    }
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

      {/* 選項：聽力題要等音檔播完（或已判定播完）才顯示，避免用猜的搶快；
          但公布答案階段（isShowingResult）一定要顯示，不然學生看不到自己對錯；
          倒數只剩 5 秒內強制顯示——保底機制，避免音檔實際長度超過系統算出的
          作答視窗（例如舊資料 audioDurationSec 是 null、或音檔載入失敗）時，
          學生從頭到尾看不到選項、必然逾時 0 分 */}
      {(isShowingResult || remaining <= 5 || (audioState !== 'playing' && audioState !== 'blocked')) && (
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
