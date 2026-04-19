'use client';

import { useState } from 'react';

type Props = {
  accessCode: string;
  title: string;
};

// 卡片資訊區 hover 浮現的快捷：分享 + 複製連結（client-side）
export function QuizCardActions({ accessCode, title }: Props) {
  const [copied, setCopied] = useState(false);

  const url = typeof window !== 'undefined'
    ? `${window.location.origin}/quiz/${accessCode}`
    : `/quiz/${accessCode}`;

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 部分瀏覽器在非安全環境會擋 clipboard API；失敗時顯示短暫提示
      console.warn('Clipboard API 不可用，請手動複製連結：', url);
    }
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        // 使用者取消分享即可，不處理
      }
    } else {
      // 桌機 fallback：開 LINE 分享視窗
      const lineUrl = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}`;
      window.open(lineUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="absolute right-3 top-3 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      <button
        type="button"
        onClick={handleShare}
        title="分享"
        className="flex size-7 items-center justify-center rounded-full border bg-white text-gray-600 shadow-sm hover:bg-primary hover:text-white"
      >
        <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
        </svg>
      </button>
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? '已複製！' : '複製連結'}
        className={`flex size-7 items-center justify-center rounded-full border bg-white shadow-sm transition-colors ${
          copied ? 'border-emerald-400 text-emerald-600' : 'text-gray-600 hover:bg-primary hover:text-white'
        }`}
      >
        {copied
          ? (
              <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            )
          : (
              <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
              </svg>
            )}
      </button>
    </div>
  );
}
