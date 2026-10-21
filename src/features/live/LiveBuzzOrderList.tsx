'use client';

import type { LiveBuzzEntry, LiveBuzzResult } from '@/services/live/types';

const BUZZ_RESULT_LABEL: Record<LiveBuzzResult, { text: string; className: string }> = {
  queued: { text: '排隊中', className: 'bg-amber-100 text-amber-800' },
  answering: { text: '作答中', className: 'bg-blue-100 text-blue-700' },
  correct: { text: '答對 +100', className: 'bg-green-100 text-green-700' },
  wrong: { text: '答錯 −50', className: 'bg-red-100 text-red-700' },
  timeout: { text: '逾時 −50', className: 'bg-red-100 text-red-700' },
};

type Props = {
  buzzes: LiveBuzzEntry[];
  highlightTeamId?: number | null; // 學生端：標出自己這組
  size?: 'md' | 'lg'; // lg = 投影畫面
};

/** 即時搶答順序（學生端與投影畫面共用）：第幾個搶到、哪一組、誰按的、目前結果 */
export function LiveBuzzOrderList({ buzzes, highlightTeamId = null, size = 'md' }: Props) {
  const sorted = [...buzzes].sort((a, b) => a.order - b.order);
  const text = size === 'lg' ? 'text-base' : 'text-sm';
  return (
    <section className="rounded-xl border bg-card p-4" aria-label="搶答順序">
      <h3 className="mb-2 text-sm font-semibold text-muted-foreground">搶答順序</h3>
      {sorted.length === 0
        ? <p className="py-3 text-center text-sm text-muted-foreground">還沒有組搶答</p>
        : (
            <ol className="space-y-1.5" data-testid="buzz-order-list">
              {sorted.map((b) => {
                const mine = highlightTeamId !== null && b.teamId === highlightTeamId;
                return (
                  <li
                    key={b.id}
                    data-testid="buzz-order-item"
                    className={`flex items-center gap-2 rounded-lg px-2 py-1 transition-colors ${text} ${
                      mine ? 'bg-primary/10 font-semibold' : ''
                    }`}
                  >
                    <span className="w-14 shrink-0 font-mono font-bold">{`第 ${b.order}`}</span>
                    <span className="font-semibold">{mine ? `${b.teamName}（你們）` : b.teamName}</span>
                    <span className="flex-1 truncate text-muted-foreground">{b.nickname}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${BUZZ_RESULT_LABEL[b.result].className}`}>
                      {BUZZ_RESULT_LABEL[b.result].text}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
    </section>
  );
}
