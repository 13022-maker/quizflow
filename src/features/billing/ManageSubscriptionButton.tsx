'use client';

/**
 * 管理訂閱按鈕：呼叫 /api/paddle/portal 取得 Paddle Customer Portal 網址後開新分頁
 * （取消訂閱、更新付款方式、下載收據皆在 Paddle portal 完成）
 */

import { useState } from 'react';

export function ManageSubscriptionButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/paddle/portal', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? '無法開啟訂閱管理頁面');
      }
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : '無法開啟訂閱管理頁面');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="rounded-lg border px-5 py-2 text-sm transition-colors hover:bg-muted disabled:opacity-60"
      >
        {loading ? '開啟中...' : '管理訂閱 / 取消 / 收據'}
      </button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
