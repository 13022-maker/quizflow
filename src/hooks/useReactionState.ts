// 課堂 Emoji 回饋 client hook：訂閱 Ably channel + in-memory aggregate
'use client';

import { useEffect, useRef, useState } from 'react';

import type { ReactionEmojiId, ReactionEvent } from '@/services/reactions/types';
import { reactionChannelName } from '@/services/reactions/types';

export type ReactionCounts = Record<ReactionEmojiId, number>;

const ZERO_COUNTS: ReactionCounts = {
  got_it: 0,
  foggy: 0,
  question: 0,
  too_fast: 0,
  too_slow: 0,
};

export type ReactionStateOptions = {
  pin: string;
  role: 'host' | 'student';
  // 過去 N 秒的 timeline 留多久（預設 30 秒）
  timelineWindowMs?: number;
};

export function useReactionState({ pin, role, timelineWindowMs = 30_000 }: ReactionStateOptions) {
  const [counts, setCounts] = useState<ReactionCounts>(ZERO_COUNTS);
  const [recent, setRecent] = useState<ReactionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  // ref 給 publish 函式用，避免 stale closure
  const channelRef = useRef<{ publish: (name: string, data: unknown) => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cleanups: Array<() => void> = [];

    const channelName = reactionChannelName(pin);

    (async () => {
      try {
        const { default: Ably } = await import('ably');
        if (cancelled) {
          return;
        }
        const realtime = new Ably.Realtime({
          authUrl: '/api/reactions/token',
          authParams: { role, pin },
          authMethod: 'POST',
        });
        cleanups.push(() => realtime.close());

        realtime.connection.on('connected', () => {
          if (!cancelled) {
            setConnected(true);
            setError(null);
          }
        });
        realtime.connection.on('failed', (err) => {
          if (!cancelled) {
            setError(`連線失敗：${err.reason?.message ?? 'unknown'}`);
            setConnected(false);
          }
        });

        const channel = realtime.channels.get(channelName);
        channelRef.current = channel;

        await channel.subscribe('emoji', (msg) => {
          if (cancelled) {
            return;
          }
          const data = msg.data as ReactionEvent | undefined;
          if (!data || !data.emoji) {
            return;
          }
          // 累計 count
          setCounts(prev => ({ ...prev, [data.emoji]: (prev[data.emoji] ?? 0) + 1 }));
          // 加 timeline，並丟掉視窗外的舊事件
          setRecent((prev) => {
            const cutoff = Date.now() - timelineWindowMs;
            return [...prev, data].filter(e => e.ts >= cutoff);
          });
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'init failed');
        }
      }
    })();

    return () => {
      cancelled = true;
      for (const fn of cleanups) {
        try {
          fn();
        } catch { /* ignore */ }
      }
      channelRef.current = null;
    };
  }, [pin, role, timelineWindowMs]);

  // 學生端發送 emoji；老師端通常不發
  const sendEmoji = (emoji: ReactionEmojiId) => {
    if (!channelRef.current) {
      return;
    }
    const evt: ReactionEvent = { emoji, ts: Date.now() };
    try {
      channelRef.current.publish('emoji', evt);
    } catch {
      // 靜默失敗（網路抖動）
    }
  };

  // 老師端清空計數（純 client 端 reset，不影響其他訂閱者）
  const resetCounts = () => {
    setCounts(ZERO_COUNTS);
    setRecent([]);
  };

  return {
    counts,
    recent,
    connected,
    error,
    sendEmoji,
    resetCounts,
  };
}
