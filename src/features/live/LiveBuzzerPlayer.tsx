'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useServerNow } from '@/hooks/useServerNow';
import {
  type BuzzFeedEvent,
  derivePlayerBuzzPhase,
  latestBuzzEvent,
  type PlayerBuzzPhase,
} from '@/services/live/buzzer';
import type { LivePlayerState, LiveQuestionOption } from '@/services/live/types';

import { LiveBuzzOrderList } from './LiveBuzzOrderList';

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
  // 樂觀狀態：一按下就鎖住按鈕並顯示「已按下，確認中」，不等 server 回應；
  // server 回來（回應帶完整看板）就換成正式名次，被拒才解鎖並顯示原因。避免連點換來「已經搶過了」
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
    setBuzzedQuestionId(currentQuestion.id); // 先鎖住（樂觀），失敗再解開
    // 手機震一下，按下的瞬間就有回饋（不支援的瀏覽器略過）
    try {
      navigator.vibrate?.(40);
    } catch {}
    const res = await onBuzz(currentQuestion.id);
    if (!res.ok) {
      setBuzzedQuestionId(null);
      setError(res.error);
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
  const myTeamId = buzzer.myTeam?.id ?? null;
  const feed = phase.kind === 'reading' || phase.kind === 'revealed' || phase.kind === 'my_team_failed'
    ? null // 我組答錯時，自己的狀態訊息已經講了「−50，換第 N 組」
    : latestBuzzEvent(buzzer.buzzes);

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

      {feed && <FeedNotice event={feed} myTeamName={buzzer.myTeam?.name ?? null} />}

      {phase.kind === 'answering_me'
        ? (
            <AnswerPanel
              teamName={buzzer.myTeam?.name ?? ''}
              options={currentQuestion.options}
              isMulti={isMulti}
              secondsLeft={phase.secondsLeft}
              selectedSingle={selectedSingle}
              selectedMulti={selectedMulti}
              onSelectSingle={setSelectedSingle}
              onToggleMulti={toggleMulti}
              onSubmit={handleSubmit}
              disabled={busy || sending}
              sending={sending}
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
                {buzzLabel(phase, justBuzzed)}
              </button>
            </>
          )}

      {/* 被拒的原因只在還能操作的狀態顯示；例如隊友同時按、我被拒「已經搶過了」，看板一到就改顯示正式名次 */}
      {error && (phase.kind === 'open' || phase.kind === 'other_team_answering' || phase.kind === 'answering_me') && (
        <p className="text-center text-sm font-medium text-destructive" role="alert">{error}</p>
      )}

      {phase.kind !== 'reading' && phase.kind !== 'no_team' && (
        <LiveBuzzOrderList buzzes={buzzer.buzzes} highlightTeamId={myTeamId} />
      )}

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

function buzzLabel(phase: PlayerBuzzPhase, justBuzzed: boolean): string {
  if (justBuzzed) {
    return '確認中⋯';
  }
  switch (phase.kind) {
    case 'reading':
      return `看題中 ${phase.secondsLeft}`;
    case 'open':
      return '搶答！';
    case 'other_team_answering':
      return phase.canBuzz ? '搶答排隊' : '等待中';
    case 'queued':
      return `第 ${phase.order} 個搶到`;
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

function failText(result: 'wrong' | 'timeout') {
  return result === 'timeout' ? '逾時 −50' : '答錯 −50';
}

/** 「最新動態」：某組答錯 / 逾時後作答權怎麼流轉（只描述既有規則的結果） */
function FeedNotice({ event, myTeamName }: { event: BuzzFeedEvent; myTeamName: string | null }) {
  const who = (name: string) => (name === myTeamName ? '你們' : name);
  const text = event.kind === 'passed'
    ? `${who(event.failedTeamName)}${failText(event.failedResult)}，換${who(event.nextTeamName)}作答`
    : `${who(event.failedTeamName)}${failText(event.failedResult)}，重新開放搶答！`;
  return (
    <p
      data-testid="buzz-feed"
      aria-live="polite"
      className="rounded-lg bg-orange-50 px-3 py-2 text-center text-sm font-medium text-orange-800"
    >
      {text}
    </p>
  );
}

function PhaseMessage({ phase, state, justBuzzed }: { phase: PlayerBuzzPhase; state: LivePlayerState; justBuzzed: boolean }) {
  const base = 'min-h-[3rem] rounded-xl px-4 py-3 text-center text-base font-medium';
  // aria-live：狀態一變，螢幕閱讀器也會唸出來
  const live = { 'role': 'status', 'aria-live': 'polite' as const, 'data-testid': 'buzz-status' };
  if (justBuzzed) {
    return <p {...live} className={`${base} bg-amber-50 text-amber-800`}>已按下，等待確認⋯</p>;
  }
  switch (phase.kind) {
    case 'reading':
      return <p {...live} className={`${base} bg-muted text-muted-foreground`}>先看題目，倒數結束才能搶答</p>;
    case 'open':
      return <p {...live} className={`${base} bg-red-50 text-red-700`}>開放搶答！按下去就是你們組的</p>;
    case 'other_team_answering':
      return (
        <div {...live} className={`${base} bg-blue-50 text-blue-800`}>
          <p>{`${phase.teamName}正在作答⋯（剩 ${phase.secondsLeft} 秒）`}</p>
          {phase.canBuzz && <p className="text-xs font-normal">對方答錯就換下一組，可以先搶排隊</p>}
        </div>
      );
    case 'queued':
      return (
        <div {...live} className={`${base} bg-amber-50 text-amber-800`}>
          <p>
            {phase.answeringTeamName
              ? `你們是第 ${phase.order} 個搶到，等待${phase.answeringTeamName}作答`
              : `你們是第 ${phase.order} 個搶到，即將輪到你們`}
          </p>
          <p className="text-xs font-normal">
            {phase.position > 1
              ? `前面還有 ${phase.position - 1} 組排隊；前面的組答錯才輪到你們`
              : '前一組答錯或逾時，就輪到你們作答'}
          </p>
        </div>
      );
    case 'answering_teammate':
      return (
        <p {...live} className={`${base} bg-green-50 text-green-800`}>
          {`輪到你們作答！${phase.nickname} 正在作答（剩 ${phase.secondsLeft} 秒）`}
        </p>
      );
    case 'my_team_failed':
      return (
        <p {...live} className={`${base} bg-red-50 text-red-800`}>
          {`${phase.result === 'timeout' ? '你們作答逾時' : '你們答錯了'} −50，${
            phase.answeringTeamName ? `換${phase.answeringTeamName}作答` : '等待其他組'
          }`}
        </p>
      );
    case 'no_team':
      return <p {...live} className={`${base} bg-muted text-muted-foreground`}>分組中，請稍候⋯</p>;
    case 'revealed': {
      const winner = state.buzzer?.buzzes.find(b => b.result === 'correct');
      const myTeamId = state.buzzer?.myTeam?.id;
      const mine = !!winner && winner.teamId === myTeamId;
      const myFail = state.buzzer?.buzzes.find(b => b.teamId === myTeamId && (b.result === 'wrong' || b.result === 'timeout'));
      let text = '這題沒有組答對';
      if (winner) {
        text = mine ? '🎉 你們答對了！+100' : `🎉 ${winner.teamName}答對！+100`;
      }
      if (myFail) {
        text += `（你們這題${myFail.result === 'timeout' ? '逾時' : '答錯'} −50）`;
      }
      return (
        <p {...live} className={`${base} ${mine ? 'bg-green-50 text-green-800' : 'bg-muted text-foreground'}`}>
          {text}
        </p>
      );
    }
    default:
      return null;
  }
}

function AnswerPanel({
  teamName,
  sending,
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
  teamName: string;
  sending: boolean;
}) {
  const hasSelection = isMulti ? selectedMulti.size > 0 : !!selectedSingle;
  const percent = Math.min(100, Math.max(0, (secondsLeft / 15) * 100));
  return (
    <div className="space-y-3 rounded-2xl border-2 border-green-500 bg-green-50/50 p-4">
      <div className="flex items-center justify-between">
        <div role="status" aria-live="assertive">
          <p className="text-lg font-bold text-green-800">🙋 輪到你們作答！</p>
          <p className="text-xs text-green-800">{`由你代表${teamName}作答，答對 +100、答錯 −50`}</p>
        </div>
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
        {sending ? '已送出，判定中⋯' : '送出答案'}
      </Button>
    </div>
  );
}
