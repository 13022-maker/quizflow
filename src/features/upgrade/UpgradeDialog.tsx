'use client';

/**
 * UpgradeDialog — 通用「升級 Pro」提示對話框
 * 使用情境：
 *  - AI 出題超出額度時從 client 端觸發
 *  - 其他 Pro-only 功能被點擊時
 */

import Link from 'next/link';
import { useEffect } from 'react';

type Feature = {
  title: string;
  description: string;
};

const DEFAULT_FEATURES: Feature[] = [
  { title: '無限 AI 出題', description: '每月次數不受限，隨時生成新題目' },
  { title: '無限測驗數量', description: '建立與管理的測驗份數無上限' },
  { title: 'AI 班級分析', description: '弱點診斷、教學建議、錯題分析一次到位' },
  { title: 'CSV 匯出 + 分享', description: '成績匯出、Google Classroom 分享' },
];

type Props = {
  open: boolean;
  onClose: () => void;
  reason?: string;
  features?: Feature[];
};

export function UpgradeDialog({
  open,
  onClose,
  reason = '此功能為 Pro 限定，升級後立即解鎖',
  features = DEFAULT_FEATURES,
}: Props) {
  // Esc 關閉
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl bg-card shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* 漸層頂欄 */}
        <div className="bg-gradient-to-r from-primary/80 to-primary px-6 py-5 text-primary-foreground">
          <p className="text-sm opacity-90">Pro 方案解鎖更多可能</p>
          <h2 className="mt-1 text-xl font-bold">{reason}</h2>
        </div>

        {/* 功能清單 */}
        <ul className="space-y-3 px-6 py-5">
          {features.map(f => (
            <li key={f.title} className="flex gap-3">
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
              >
                ✓
              </span>
              <div>
                <p className="text-sm font-semibold">{f.title}</p>
                <p className="text-xs text-muted-foreground">{f.description}</p>
              </div>
            </li>
          ))}
        </ul>

        {/* 價格 */}
        <div className="border-t px-6 py-4 text-center">
          <p className="text-xs text-muted-foreground">Pro 老師年繳方案</p>
          <p className="mt-1 text-2xl font-bold tracking-tight">
            <span className="text-base font-medium text-muted-foreground">NT$</span>
            2,490
            <span className="ml-1 text-base font-normal text-muted-foreground">/年</span>
          </p>
          <p className="text-xs text-muted-foreground">
            平均每月 NT$208，比一頓便當還便宜
          </p>
        </div>

        {/* 按鈕列 */}
        <div className="flex gap-2 border-t bg-muted/30 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            再想想
          </button>
          <Link
            href="/dashboard/billing"
            className="flex-1 rounded-lg bg-primary px-4 py-2 text-center text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
            onClick={onClose}
          >
            前往升級 →
          </Link>
        </div>
      </div>
    </div>
  );
}
