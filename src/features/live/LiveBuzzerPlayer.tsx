'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useServerNow } from '@/hooks/useServerNow';
import { derivePlayerBuzzPhase, type PlayerBuzzPhase } from '@/services/live/buzzer';
import type { LivePlayerState, LiveQuestionOption } from '@/services/live/types';

export type BuzzActionResult = { ok: true } | { ok: false; error: string };

type Props = {
  state: LivePlayerState;
  onBuzz: (questionId: number) => Promise<BuzzActionResult>;
  onAnswer: (questionId: number, selectedOptionId: string | string[]) => Promise<BuzzActionResult>;
  busy: boolean; // 斷線重連中等情況，暫停所有操作
};

const optionLabel = (i: number) => String.fromCharCode(65 + i);

/** 學生端小組搶答畫面（手機優先）：超大搶答鈕 + 各狀態文字；搶到的人在這裡作答 */
export function LiveBuzzerPlayer({ state, onBuzz, onAnswer, busy }: Props) {
  const { game, currentQuestion, buzzer, me, lastResult } = state;
  const nowMs = useServerNow(buzzer?.serverNow);

  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // 按下搶答成功、但輪詢還沒帶回新 state 的空檔：先鎖住按鈕，避免連點換來「已經搶過了」
  const [buzzedQuestionId, setBuzzedQuestionId] = useState<number | null>(null);
  const [selectedSingle, setSelectedSingle] = useState<string | null>(null);
  const [selectedMulti, setSelectedMulti] = useState<Set<string>>(new Set());

  const questionId = currentQuestion?.id ?? null;
  useEffect(() => {
    setError(null);
    setBuzzedQuestionId(null);
    setSelectedSingle(null);
    setSelectedMulti(new Set());
  }, [questionId]);

  if (!currentQuestion || !buzzer) {
    return <div className="py-20 text-center text-muted-foreground">載入題目中⋯</div>;
  }

  const phase = derivePlayerBuzzPhase({
    status: game.status,
    questionStartedAtMs: game.questionStartedAt ? Date.parse(game.questionStartedAt) : null,
    nowMs,
    myTeamId: buzzer.myTeam?.id ?? null,
    myPlayerId: me.id,
    buzzes: buzzer.buzzes.map(b => ({
      ...b,
      answerGrantedAtMs: b.answerGrantedAt ? Date.parse(b.answerGrantedAt) : null,
    })),
  });

  const isMulti = currentQuestion.type === 'multiple_choice';
  const justBuzzed = buzzedQuestionId === currentQuestion.id
    && (phase.kind === 'open' || (phase.kind === 'other_team_answering' && phase.canBuzz));

  const handleBuzz = async () => {
    setError(null);
    setSending(true);
    try {
      const res = await onBuzz(currentQuestion.id);
      if (res.ok) {
        setBuzzedQuestionId(currentQuestion.id);
      } else {
        setError(res.error);
      }
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = async () => {
    const selection = isMulti ? Array.from(selectedMulti) : selectedSingle;
    if (!selection || (Array.isArray(selection) && selection.length === 0)) {
      return;
    }
    setError(null);
    setSending(true);
    try {
      const res = await onAnswer(currentQuestion.id, selection);
      if (!res.ok) {
        setError(res.error);
      }
    } finally {
      setSending(false);
    }
  };

  const toggleMulti = (id: string) => {
    const next = new Set(selectedMulti);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedMulti(next);
  };

  const canBuzz = !busy && !sending && !justBuzzed
    && (phase.kind === 'open' || (phase.kind === 'other_team_answering' && phase.canBuzz));

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-5">
      {/* 我是第幾組 + 組分 */}
      <div className="flex items-center justify-between rounded-xl bg-primary/10 px-4 py-2">
        <span className="text-lg font-bold text-primary">{buzzer.myTeam?.name ?? '尚未分組'}</span>
        <span className="text-sm">
          {`組分 ${buzzer.myTeam?.score ?? 0}`}
        </span>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{`Q${game.currentQuestionIndex + 1} / ${game.totalQuestions}`}</span>
        <span>{me.nickname}</span>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <h2 className="text-lg font-semibold leading-relaxed">{currentQuestion.body}</h2>
        {currentQuestion.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={currentQuestion.imageUrl} alt="" className="mt-3 max-h-56 rounded-lg" />
        )}
      </div>

      {phase.kind === 'answering_me'
        ? (
            <AnswerPanel
              options={currentQuestion.options}
              isMulti={isMulti}
              secondsLeft={phase.secondsLeft}
              selectedSingle={selectedSingle}
              selectedMulti={selectedMulti}
              onSelectSingle={setSelectedSingle}
              onToggleMulti={toggleMulti}
              onSubmit={handleSubmit}
              disabled={busy || sending}
            />
          )
        : (
            <>
              <PhaseMessage phase={phase} state={state} justBuzzed={justBuzzed} />
              <button
                type="button"
                data-testid="buzz-button"
                disabled={!canBuzz}
                onClick={handleBuzz}
                className={`flex min-h-[132px] w-full select-none items-center justify-center rounded-3xl text-4xl font-black tracking-wider shadow-lg transition-all duration-75 ${
                  canBuzz
                    ? 'bg-red-500 text-white shadow-red-500/40 hover:bg-red-600 active:translate-y-1 active:scale-95 active:shadow-sm'
                    : 'cursor-not-allowed bg-muted text-muted-foreground shadow-none'
                }`}
              >
                {buzzLabel(phase, sending, justBuzzed)}
              </button>
            </>
          )}

      {error && <p className="text-center text-sm font-medium text-destructive" role="alert">{error}</p>}

      {phase.kind === 'revealed' && lastResult && (
        <p className="text-center text-sm">
          {`正解：${lastResult.correctAnswers
            .map((id) => {
              const i = currentQuestion.options.findIndex(o => o.id === id);
              return i >= 0 ? `${optionLabel(i)}. ${currentQuestion.options[i]!.text}` : id;
            })
            .join('、')}`}
        </p>
      )}
    </div>
  );
}

function buzzLabel(phase: PlayerBuzzPhase, sending: boolean, justBuzzed: boolean): string {
  if (sending) {
    return '送出中⋯';
  }
  if (justBuzzed) {
    return '已搶到';
  }
  switch (phase.kind) {
    case 'reading':
      return `看題中 ${phase.secondsLeft}`;
    case 'open':
      return '搶答！';
    case 'other_team_answering':
      return phase.canBuzz ? '搶答排隊' : '等待中';
    case 'queued':
      return '已搶到';
    case 'answering_teammate':
      return '隊友作答中';
    case 'my_team_failed':
      return '本題已作答';
    case 'no_team':
      return '等待分組';
    case 'revealed':
      return '本題結束';
    default:
      return '搶答！';
  }
}

function PhaseMessage({ phase, state, justBuzzed }: { phase: PlayerBuzzPhase; state: LivePlayerState; justBuzzed: boolean }) {
  const base = 'min-h-[3rem] rounded-xl px-4 py-3 text-center text-base font-medium';
  if (justBuzzed) {
    return <p className={`${base} bg-amber-50 text-amber-800`}>已送出搶答，等待確認⋯</p>;
  }
  switch (phase.kind) {
    case 'reading':
      return <p className={`${base} bg-muted text-muted-foreground`}>先看題目，倒數結束才能搶答</p>;
    case 'open':
      return <p className={`${base} bg-red-50 text-red-700`}>開放搶答！按下去就是你們組的</p>;
    case 'other_team_answering':
      return (
        <div className={`${base} bg-blue-50 text-blue-800`}>
          <p>{`${phase.teamName}作答中`}</p>
          {phase.canBuzz && <p className="text-xs font-normal">對方答錯就換下一組，可以先搶排隊</p>}
        </div>
      );
    case 'queued':
      return (
        <p className={`${base} bg-amber-50 text-amber-800`}>
          {`已搶到！排隊第 ${phase.position} 位，等待作答權${phase.answeringTeamName ? `（${phase.answeringTeamName}作答中）` : ''}`}
        </p>
      );
    case 'answering_teammate':
      return (
        <p className={`${base} bg-green-50 text-green-800`}>
          {`${phase.nickname} 搶到了，正在作答（剩 ${phase.secondsLeft} 秒）`}
        </p>
      );
    case 'my_team_failed':
      return <p className={`${base} bg-muted text-muted-foreground`}>你的組這題答錯了，等待其他組</p>;
    case 'no_team':
      return <p className={`${base} bg-muted text-muted-foreground`}>分組中，請稍候⋯</p>;
    case 'revealed': {
      const winner = state.buzzer?.buzzes.find(b => b.result === 'correct');
      const myTeamId = state.buzzer?.myTeam?.id;
      return (
        <p className={`${base} ${winner && winner.teamId === myTeamId ? 'bg-green-50 text-green-800' : 'bg-muted text-foreground'}`}>
          {winner ? `🎉 ${winner.teamName}答對！+100` : '這題沒有組答對'}
        </p>
      );
    }
    default:
      return null;
  }
}

function AnswerPanel({
  options,
  isMulti,
  secondsLeft,
  selectedSingle,
  selectedMulti,
  onSelectSingle,
  onToggleMulti,
  onSubmit,
  disabled,
}: {
  options: LiveQuestionOption[];
  isMulti: boolean;
  secondsLeft: number;
  selectedSingle: string | null;
  selectedMulti: Set<string>;
  onSelectSingle: (id: string) => void;
  onToggleMulti: (id: string) => void;
  onSubmit: () => void;
  disabled: boolean;
}) {
  const hasSelection = isMulti ? selectedMulti.size > 0 : !!selectedSingle;
  const percent = Math.min(100, Math.max(0, (secondsLeft / 15) * 100));
  return (
    <div className="space-y-3 rounded-2xl border-2 border-green-500 bg-green-50/50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-lg font-bold text-green-800">🙋 輪到你作答！</p>
        <p className="font-mono text-lg font-bold">{`剩 ${secondsLeft} 秒`}</p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full transition-all ${secondsLeft <= 5 ? 'bg-red-500' : 'bg-green-500'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {isMulti && <p className="text-xs text-muted-foreground">複選題：選出所有正確答案</p>}
      <div className="space-y-2">
        {options.map((opt, i) => {
          const picked = isMulti ? selectedMulti.has(opt.id) : selectedSingle === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              aria-pressed={picked}
              onClick={() => (isMulti ? onToggleMulti(opt.id) : onSelectSingle(opt.id))}
              className={`flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-colors ${
                picked ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/40'
              }`}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold">
                {optionLabel(i)}
              </span>
              <span className="flex-1 text-sm">{opt.text}</span>
            </button>
          );
        })}
      </div>
      <Button size="lg" className="w-full" onClick={onSubmit} disabled={disabled || !hasSelection}>
        送出答案
      </Button>
    </div>
  );
}
