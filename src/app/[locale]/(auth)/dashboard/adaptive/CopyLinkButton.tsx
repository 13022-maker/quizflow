'use client';

/** 複製學生分享連結（以目前網域組完整網址） */
import { useState } from 'react';

// variant=primary：練習還沒有學生時當作卡片主按鈕（實心主色），引導老師先把連結發出去
export function CopyLinkButton({ path, variant = 'default' }: { path: string; variant?: 'default' | 'primary' }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪貼簿權限被拒時不中斷，老師仍可手動複製畫面上的網址
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={
        variant === 'primary'
          ? `inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            copied ? 'bg-emerald-600 text-white' : 'bg-primary text-primary-foreground hover:bg-primary/90'
          }`
          : `inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted ${
            copied ? 'text-emerald-600' : ''
          }`
      }
    >
      {copied ? '✓ 已複製' : '📋 複製學生連結'}
    </button>
  );
}
