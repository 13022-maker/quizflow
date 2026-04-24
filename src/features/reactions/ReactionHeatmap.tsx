// 老師端熱圖：5 個 emoji 卡片 + 各自累計 count + 漸層條
'use client';

import type { ReactionCounts } from '@/hooks/useReactionState';
import { REACTION_EMOJIS } from '@/services/reactions/types';

export function ReactionHeatmap({ counts }: { counts: ReactionCounts }) {
  // 算最大值用來決定條色強度
  const max = Math.max(1, ...REACTION_EMOJIS.map(e => counts[e.id] ?? 0));

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {REACTION_EMOJIS.map((e) => {
        const count = counts[e.id] ?? 0;
        const ratio = count / max;
        return (
          <div
            key={e.id}
            className="rounded-xl border bg-card p-4 text-center shadow-sm"
          >
            <div className="text-3xl sm:text-4xl">{e.emoji}</div>
            <p className="mt-1 text-xs font-medium text-muted-foreground">{e.label}</p>
            <p className="mt-2 font-mono text-2xl font-black tracking-tight sm:text-3xl">
              {count}
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${Math.round(ratio * 100)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
