// 學生端：5 大按鈕，按下發 emoji event。完全匿名，無歷史顯示。
'use client';

import { useRef, useState } from 'react';

import { useReactionState } from '@/hooks/useReactionState';
import type { ReactionEmojiId } from '@/services/reactions/types';
import { REACTION_EMOJIS } from '@/services/reactions/types';

const COOLDOWN_MS = 2000; // 同 emoji 2 秒內限 1 次

export function StudentReactionPanel({ pin }: { pin: string }) {
  const { sendEmoji, connected, error } = useReactionState({ pin, role: 'student' });
  const [justClicked, setJustClicked] = useState<ReactionEmojiId | null>(null);
  const lastClickRef = useRef<Record<ReactionEmojiId, number>>({
    got_it: 0,
    foggy: 0,
    question: 0,
    too_fast: 0,
    too_slow: 0,
  });

  const handleClick = (id: ReactionEmojiId) => {
    const now = Date.now();
    if (now - lastClickRef.current[id] < COOLDOWN_MS) {
      return;
    }
    lastClickRef.current[id] = now;
    sendEmoji(id);
    setJustClicked(id);
    // 短暫震動回饋（iOS Safari 不支援，靜默 fallback）
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(40);
      } catch { /* ignore */ }
    }
    setTimeout(() => setJustClicked(curr => (curr === id ? null : curr)), 600);
  };

  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col px-4 py-6">
      {/* 頂部 PIN 顯示 */}
      <div className="mb-6 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          課堂回饋
        </p>
        <p className="mt-1 font-mono text-2xl font-bold tracking-widest">{pin}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          {error
            ? <span className="text-destructive">{`連線失敗：${error}`}</span>
            : connected
              ? '✓ 已連線，按下方按鈕回饋老師'
              : '連線中⋯'}
        </p>
      </div>

      {/* 5 大按鈕（垂直排列方便手機點擊） */}
      <div className="flex-1 space-y-3">
        {REACTION_EMOJIS.map((e) => {
          const just = justClicked === e.id;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => handleClick(e.id)}
              disabled={!connected}
              className={`flex w-full items-center gap-4 rounded-2xl border-2 p-5 text-left transition-all active:scale-[0.98] disabled:opacity-40 ${
                just
                  ? 'border-primary bg-primary/15 shadow-md'
                  : 'border-border bg-card hover:border-primary/40'
              }`}
            >
              <span className={`text-4xl transition-transform ${just ? 'scale-125' : ''}`}>
                {e.emoji}
              </span>
              <span className="flex-1 text-base font-semibold">{e.label}</span>
              {just && <span className="text-xs font-medium text-primary">已送出</span>}
            </button>
          );
        })}
      </div>

      <p className="mt-6 text-center text-[10px] text-muted-foreground/70">
        匿名回饋；老師看不到誰按的
      </p>
    </div>
  );
}
