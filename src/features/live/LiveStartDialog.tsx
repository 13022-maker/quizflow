'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { createLiveGame } from '@/actions/liveActions';
import { Button } from '@/components/ui/button';
import {
  BUZZER_DEFAULT_TEAMS,
  BUZZER_MAX_TEAMS,
  BUZZER_MIN_TEAMS,
} from '@/services/live/buzzer';
import type { LiveGameMode } from '@/services/live/types';

type Props = {
  quizId: number;
  onClose: () => void;
};

const MODES: { value: LiveGameMode; title: string; desc: string }[] = [
  { value: 'classic', title: '🎮 經典模式', desc: '全班同時作答，答對越快分數越高' },
  { value: 'team_buzzer', title: '🔔 小組搶答', desc: '分組搶答，搶到的組作答：答對 +100、答錯 −50' },
];

/**
 * 開 Live Mode 前選玩法的小對話框（QuizEditor 與測驗列表共用）。
 * 經典模式預設選取，老師直接按「開始」就跟原本一鍵開場一樣。
 */
export function LiveStartDialog({ quizId, onClose }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<LiveGameMode>('classic');
  const [teamCount, setTeamCount] = useState(BUZZER_DEFAULT_TEAMS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleStart = () => {
    setError(null);
    startTransition(async () => {
      // try/catch 防止 Server Action throw（例如 DB migration 未跑）導致整頁白屏
      try {
        const res = await createLiveGame(
          mode === 'team_buzzer' ? { quizId, gameMode: mode, teamCount } : { quizId },
        );
        if (!res || typeof res !== 'object') {
          setError('Live Mode 建立失敗：伺服器未回應（可能需重新登入）');
          return;
        }
        if ('error' in res) {
          setError(res.error ?? '建立失敗');
          return;
        }
        router.push(`/dashboard/live/host/${res.gameId}`);
      } catch (err) {
        setError(err instanceof Error ? `Live Mode 建立失敗：${err.message}` : 'Live Mode 建立失敗，請稍後再試');
      }
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="live-start-title"
        className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-5 shadow-lg"
      >
        <h2 id="live-start-title" className="text-lg font-semibold">開始 Live Mode</h2>

        <div className="space-y-2" role="radiogroup" aria-label="玩法">
          {MODES.map(m => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={mode === m.value}
              onClick={() => setMode(m.value)}
              className={`w-full rounded-lg border-2 px-4 py-3 text-left transition-colors ${
                mode === m.value ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40'
              }`}
            >
              <div className="font-semibold">{m.title}</div>
              <div className="text-xs text-muted-foreground">{m.desc}</div>
            </button>
          ))}
        </div>

        {mode === 'team_buzzer' && (
          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
            <span className="text-sm">組數</span>
            <TeamCountStepper value={teamCount} onChange={setTeamCount} />
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending}>取消</Button>
          <Button onClick={handleStart} disabled={isPending}>
            {isPending ? '建立中⋯' : '開始'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 組數 −／＋ 調整（2–8），大廳畫面也共用 */
export function TeamCountStepper({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label="減少組數"
        disabled={disabled || value <= BUZZER_MIN_TEAMS}
        onClick={() => onChange(Math.max(BUZZER_MIN_TEAMS, value - 1))}
      >
        −
      </Button>
      <span className="w-14 text-center font-mono text-lg font-bold" aria-live="polite">
        {value}
        {' '}
        組
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label="增加組數"
        disabled={disabled || value >= BUZZER_MAX_TEAMS}
        onClick={() => onChange(Math.min(BUZZER_MAX_TEAMS, value + 1))}
      >
        ＋
      </Button>
    </div>
  );
}
