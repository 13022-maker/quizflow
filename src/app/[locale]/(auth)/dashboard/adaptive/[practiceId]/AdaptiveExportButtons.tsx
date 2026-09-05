'use client';

import { useClerk } from '@clerk/nextjs';
import { useState } from 'react';

// Google Sheets 讀寫 scope；用來讓 Clerk 的 UserProfile 知道要幫這個 Google
// 連線多要哪個權限（不管是「從沒連過」還是「連過但沒有這個 scope」都適用）
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

type ExportState = 'idle' | 'loading' | 'not_connected' | 'error';

export function AdaptiveExportButtons({ csvHref, sheetHref }: { csvHref: string; sheetHref: string }) {
  const [state, setState] = useState<ExportState>('idle');
  const clerk = useClerk();

  async function exportToSheet() {
    setState('loading');
    try {
      const res = await fetch(sheetHref, { method: 'POST' });
      if (res.status === 409) {
        setState('not_connected');
        return;
      }
      if (!res.ok) {
        setState('error');
        return;
      }
      const data = await res.json() as { url: string };
      window.open(data.url, '_blank');
      setState('idle');
    } catch {
      setState('error');
    }
  }

  function reconnectGoogle() {
    // 打開 Clerk 內建的帳號管理視窗，帶上 Sheets scope；老師在裡面完成
    // 「連接／重新授權 Google」後，直接回這頁再按一次匯出即可，不需要自訂回調頁
    clerk.openUserProfile({
      additionalOAuthScopes: { google: [GOOGLE_SHEETS_SCOPE] },
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={csvHref}
        download
        className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
      >
        ↓ 下載 CSV
      </a>
      <button
        type="button"
        onClick={exportToSheet}
        disabled={state === 'loading'}
        className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
      >
        {state === 'loading' ? '匯出中…' : '📊 匯出到 Google Sheet'}
      </button>
      {state === 'not_connected' && (
        <span className="text-xs text-amber-600">
          尚未連接 Google 帳號的 Sheets 權限。
          {' '}
          <button type="button" onClick={reconnectGoogle} className="underline">
            重新連接
          </button>
        </span>
      )}
      {state === 'error' && <span className="text-xs text-red-600">匯出失敗，請重試</span>}
    </div>
  );
}
