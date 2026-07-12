'use client';

/** 複製學生分享連結（以目前網域組完整網址） */
import { useState } from 'react';

export function CopyLinkButton({ path }: { path: string }) {
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
      className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
    >
      {copied ? '✓ 已複製' : '📋 複製學生連結'}
    </button>
  );
}
