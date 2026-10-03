'use client';

import { useEffect, useState } from 'react';

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) {
    return null;
  }
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 以 server 時鐘校正後的「現在」（毫秒），每 200ms 更新一次。
 * 小組搶答的看題倒數 / 作答倒數都以 server（DB）時間判定，學生手機時鐘可能快慢幾秒，
 * 這裡用每次 state 帶回來的 serverNow 算出時差再補回去，讓按鈕亮起的時間跟 server 一致。
 * （時差含一次網路單程延遲，誤差通常 < 0.3 秒；server 端仍會再檢查一次，不怕提早按。）
 */
export function useServerNow(serverNowIso: string | null | undefined): number {
  // offset 與 clientNow 用同一次 Date.now() 取樣，收到新 serverNow 的當下 now 恰好等於 serverNow
  const [clock, setClock] = useState(() => {
    const t = Date.now();
    const serverMs = parseMs(serverNowIso);
    return { clientNow: t, offsetMs: serverMs === null ? 0 : serverMs - t };
  });

  useEffect(() => {
    const serverMs = parseMs(serverNowIso);
    if (serverMs === null) {
      return;
    }
    const t = Date.now();
    setClock({ clientNow: t, offsetMs: serverMs - t });
  }, [serverNowIso]);

  useEffect(() => {
    const id = setInterval(() => setClock(c => ({ ...c, clientNow: Date.now() })), 200);
    return () => clearInterval(id);
  }, []);

  return clock.clientNow + clock.offsetMs;
}
