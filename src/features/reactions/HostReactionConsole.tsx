// 老師端主控台：大字 PIN + 加入網址 + 即時熱圖 + 清空
'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useReactionState } from '@/hooks/useReactionState';

import { ReactionHeatmap } from './ReactionHeatmap';

export function HostReactionConsole({ pin }: { pin: string }) {
  const { counts, recent, connected, error, resetCounts } = useReactionState({
    pin,
    role: 'host',
  });

  const [origin, setOrigin] = useState('');
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin);
    }
  }, []);

  const joinUrl = origin ? `${origin}/reactions/${pin}` : `/reactions/${pin}`;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      {/* PIN + URL + 連線狀態 */}
      <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              課堂頻道 PIN
            </p>
            <p className="mt-2 font-mono text-4xl font-black tracking-widest sm:text-6xl">
              {pin}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              學生加入網址：
            </p>
            <p className="mt-1 break-all font-mono text-xs text-foreground">
              {joinUrl}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 text-xs">
            <span className={connected ? 'text-emerald-600' : 'text-amber-600'}>
              ●
              {' '}
              {connected ? '已連線' : '連線中⋯'}
            </span>
            {error && <span className="text-destructive">{error}</span>}
            <span className="text-muted-foreground">
              {`累計回饋 ${total}`}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={resetCounts}
              disabled={total === 0}
            >
              清空計數
            </Button>
          </div>
        </div>
      </div>

      {/* 熱圖 */}
      <section>
        <h2 className="mb-3 text-base font-semibold">即時熱圖</h2>
        <ReactionHeatmap counts={counts} />
      </section>

      {/* 最近 30 秒迷你 timeline */}
      <section>
        <h2 className="mb-3 text-base font-semibold">最近 30 秒</h2>
        {recent.length === 0
          ? (
              <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                尚無學生回饋
              </p>
            )
          : (
              <Sparkline events={recent} />
            )}
      </section>

      <p className="text-center text-[11px] text-muted-foreground/70">
        頻道與計數只活在這個視窗；關閉分頁或重新整理即清空
      </p>
    </div>
  );
}

// 簡易 sparkline：把過去 30 秒切 30 個 bucket，每 bucket 計算事件數
function Sparkline({ events }: { events: Array<{ ts: number }> }) {
  const now = Date.now();
  const windowMs = 30_000;
  const bucketCount = 30;
  const bucketMs = windowMs / bucketCount;
  const buckets = Array.from({ length: bucketCount }, () => 0);
  for (const e of events) {
    const ageMs = now - e.ts;
    if (ageMs < 0 || ageMs >= windowMs) {
      continue;
    }
    const idx = bucketCount - 1 - Math.floor(ageMs / bucketMs);
    if (idx >= 0 && idx < bucketCount) {
      buckets[idx] = (buckets[idx] ?? 0) + 1;
    }
  }
  const max = Math.max(1, ...buckets);
  return (
    <div className="flex h-16 items-end gap-0.5 rounded-lg border bg-card p-2">
      {buckets.map((b, i) => (
        <div
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          className="flex-1 rounded-sm bg-primary/70"
          style={{ height: `${(b / max) * 100}%`, minHeight: b > 0 ? '4px' : '2px', opacity: b > 0 ? 1 : 0.15 }}
          title={`${b} 件`}
        />
      ))}
    </div>
  );
}
