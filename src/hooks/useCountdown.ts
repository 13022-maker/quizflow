'use client';

import { useEffect, useState } from 'react';

/**
 * 倒數 hook：純 client 計時，每 100ms 更新（≈ 10fps），不依賴 polling。
 *
 * 兩種用法：
 *   - 推薦：`useCountdown({ endsAt, skew })` — 使用 server 給的絕對結束時間 + clock skew 校正
 *   - 相容：`useCountdown(startedAtIso, durationSec)` — 舊 API（純 client 計算 elapsed）
 *
 * server 給絕對 endsAt 是同步優化的核心：學生 / 老師時鐘不同步時，仍以 server 時間為準
 * skew = localNow - serverNow；本地校正後時間 = endsAt + skew
 */
type AbsoluteOpts = {
  endsAt: number | null; // server 端 epoch ms（或 ISO 轉換後）
  skew: number; // localNow - serverNow（ms）
  durationMs?: number; // optional：算 percent 用，未給則由 endsAt - now 推估
};

type LegacyArgs = [startedAtIso: string | null, durationSec: number];

export function useCountdown(
  ...args: [AbsoluteOpts] | LegacyArgs
): { remaining: number; elapsed: number; percent: number } {
  const [now, setNow] = useState<number>(() => Date.now());

  // Normalise → 永遠以 endsAt + duration 表達
  const opts = normaliseArgs(args);

  useEffect(() => {
    if (opts.endsAt === null) {
      return;
    }
    const id = setInterval(() => {
      setNow(Date.now());
    }, 100);
    return () => clearInterval(id);
  }, [opts.endsAt]);

  if (opts.endsAt === null) {
    const fallbackTotal = Math.max(0, opts.durationMs ?? 0);
    return { remaining: Math.ceil(fallbackTotal / 1000), elapsed: 0, percent: 0 };
  }

  // 校正：server endsAt 換算到 client 時鐘 = endsAt + skew
  const adjustedEndsAt = opts.endsAt + opts.skew;
  const remainingMs = Math.max(0, adjustedEndsAt - now);
  const totalMs = opts.durationMs ?? Math.max(remainingMs, 1);
  const elapsedMs = Math.max(0, totalMs - remainingMs);

  return {
    remaining: Math.ceil(remainingMs / 1000),
    elapsed: Math.floor(elapsedMs / 1000),
    percent: Math.min(100, Math.round((elapsedMs / totalMs) * 100)),
  };
}

function normaliseArgs(
  args: [AbsoluteOpts] | LegacyArgs,
): { endsAt: number | null; skew: number; durationMs?: number } {
  if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
    return args[0];
  }
  // legacy: (startedAtIso, durationSec)
  const [startedAtIso, durationSec] = args as LegacyArgs;
  if (!startedAtIso) {
    return { endsAt: null, skew: 0, durationMs: durationSec * 1000 };
  }
  const startedAtMs = new Date(startedAtIso).getTime();
  return {
    endsAt: startedAtMs + durationSec * 1000,
    skew: 0,
    durationMs: durationSec * 1000,
  };
}
