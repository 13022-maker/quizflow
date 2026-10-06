'use client';

import { RichText } from '@/components/quiz/RichText';
import { Button } from '@/components/ui/button';
import { useServerNow } from '@/hooks/useServerNow';
import type { LiveBuzzResult, LiveHostState } from '@/services/live/types';

type Props = {
  state: LiveHostState;
  onReveal: () => void;
  onNext: () => void;
  onEnd: () => void;
  pending: boolean;
};

const RESULT_LABEL: Record<LiveBuzzResult, { text: string; className: string }> = {
  queued: { text: '排隊中', className: 'bg-muted text-muted-foreground' },
  answering: { text: '作答中', className: 'bg-blue-100 text-blue-700' },
  correct: { text: '答對 +100', className: 'bg-green-100 text-green-700' },
  wrong: { text: '答錯 −50', className: 'bg-red-100 text-red-700' },
  timeout: { text: '逾時 −50', className: 'bg-red-100 text-red-700' },
};

const optionLabel = (i: number) => String.fromCharCode(65 + i);

/** 老師端小組搶答主控台（投影用）：題目大字、搶答順序、作答倒數、各組分數 */
export function LiveBuzzerHostScreen({ state, onReveal, onNext, onEnd, pending }: Props) {
  const { game, currentQuestion, buzzer } = state;
  const nowMs = useServerNow(buzzer?.serverNow);

  if (!currentQuestion || !buzzer) {
    return <div className="py-20 text-center text-muted-foreground">載入題目中⋯</div>;
  }

  const isShowingResult = game.status === 'showing_result';
  const isLastQuestion = game.currentQuestionIndex >= game.totalQuestions - 1;
  const startedMs = game.questionStartedAt ? Date.parse(game.questionStartedAt) : nowMs;
  const readingLeft = Math.ceil((startedMs + buzzer.readingMs - nowMs) / 1000);
  const answering = buzzer.buzzes.find(b => b.result === 'answering');
  const answerLeft = answering?.answerDeadlineAt
    ? Math.max(0, Math.ceil((Date.parse(answering.answerDeadlineAt) - nowMs) / 1000))
    : 0;
  const winner = buzzer.buzzes.find(b => b.result === 'correct');

  let banner: { text: string; className: string };
  if (isShowingResult) {
    banner = winner
      ? { text: `🎉 ${winner.teamName}（${winner.nickname}）答對！`, className: 'bg-green-100 text-green-800' }
      : { text: '揭曉答案：這題沒有組答對', className: 'bg-muted text-foreground' };
  } else if (readingLeft > 0) {
    banner = { text: `看題中⋯ ${readingLeft}`, className: 'bg-muted text-foreground' };
  } else if (answering) {
    banner = {
      text: `${answering.teamName}（${answering.nickname}）作答中・剩 ${answerLeft} 秒`,
      className: 'bg-blue-100 text-blue-800',
    };
  } else {
    banner = { text: '🔔 開放搶答！', className: 'bg-red-100 text-red-700' };
  }

  const sortedTeams = [...buzzer.teams].sort((a, b) => a.orderIndex - b.orderIndex);

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{`第 ${game.currentQuestionIndex + 1} / ${game.totalQuestions} 題・小組搶答`}</span>
        <span>{`${state.players.length} 人・${buzzer.teams.length} 組`}</span>
      </div>

      <div className="rounded-2xl border bg-card p-6">
        <RichText as="h2" text={currentQuestion.body} className="text-2xl font-bold leading-relaxed md:text-3xl" />
        {currentQuestion.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={currentQuestion.imageUrl} alt="" className="mt-4 max-h-72 rounded-lg" />
        )}
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {currentQuestion.options.map((opt, i) => {
            // 投影畫面：揭曉前不標正解
            const isCorrect = isShowingResult && currentQuestion.correctAnswers.includes(opt.id);
            return (
              <li
                key={opt.id}
                className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-lg ${
                  isCorrect ? 'border-green-500 bg-green-50 font-semibold' : 'border-border'
                }`}
              >
                <span className="font-bold">{optionLabel(i)}</span>
                <RichText as="span" text={opt.text} className="flex-1" />
                {isCorrect && <span>✓</span>}
              </li>
            );
          })}
        </ul>
      </div>

      <div className={`rounded-xl px-4 py-3 text-center text-xl font-bold ${banner.className}`}>
        {banner.text}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">搶答順序</h3>
          {buzzer.buzzes.length === 0
            ? <p className="py-4 text-center text-sm text-muted-foreground">還沒有組搶答</p>
            : (
                <ol className="space-y-1.5">
                  {buzzer.buzzes.map(b => (
                    <li key={b.id} className="flex items-center gap-2 text-sm">
                      <span className="w-6 text-center font-mono font-bold">{b.order}</span>
                      <span className="font-semibold">{b.teamName}</span>
                      <span className="flex-1 truncate text-muted-foreground">{b.nickname}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${RESULT_LABEL[b.result].className}`}>
                        {RESULT_LABEL[b.result].text}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
        </section>

        <section className="rounded-xl border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">各組分數</h3>
          <ul className="grid grid-cols-2 gap-2">
            {sortedTeams.map(t => (
              <li key={t.id} className="rounded-lg bg-muted/50 px-3 py-2">
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold">{t.name}</span>
                  <span className="font-mono text-lg font-bold">{t.score}</span>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {t.members.map(m => m.nickname).join('、') || '（無成員）'}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="flex flex-wrap justify-center gap-3">
        {!isShowingResult
          ? <Button size="lg" onClick={onReveal} disabled={pending}>揭曉答案</Button>
          : (
              <Button size="lg" onClick={onNext} disabled={pending}>
                {isLastQuestion ? '看小組排行榜' : '下一題'}
              </Button>
            )}
        <Button size="lg" variant="outline" onClick={onEnd} disabled={pending}>結束</Button>
      </div>
    </div>
  );
}
