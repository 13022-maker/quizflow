'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { copyVocabFromMarketplace } from '@/actions/marketplaceActions';

type Props = {
  set: {
    id: number;
    title: string;
    accessCode: string | null;
    category: string | null;
    gradeLevel: string | null;
    forkCount: number;
    createdAt: string;
  };
  cardCount: number;
};

export function MarketplaceVocabCard({ set, cardCount }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  // 複製到我的單字卡集 → 成功跳轉 dashboard 列表
  const handleCopy = () => {
    startTransition(async () => {
      const res = await copyVocabFromMarketplace(set.id);
      if (res?.error) {
        // eslint-disable-next-line no-alert
        window.alert(res.error);
        return;
      }
      if (res?.newSetId) {
        setCopied(true);
        setTimeout(() => {
          router.push('/dashboard/vocab');
        }, 500);
      }
    });
  };

  return (
    <div className="group flex flex-col rounded-xl border bg-card p-5 shadow-sm transition-all hover:shadow-md">
      {/* 標籤 */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {set.category && (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
            {set.category}
          </span>
        )}
        {set.gradeLevel && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
            {set.gradeLevel}
          </span>
        )}
      </div>

      {/* 標題 */}
      <h3 className="mb-1 text-base font-semibold leading-snug text-foreground">
        {set.title}
      </h3>

      <div className="mt-auto" />

      {/* 數據 */}
      <div className="mb-3 flex items-center gap-3 text-xs text-muted-foreground">
        <span>
          {cardCount}
          {' '}
          張卡片
        </span>
        <span>·</span>
        <span>
          {set.forkCount}
          {' '}
          人使用
        </span>
      </div>

      {/* 兩顆按鈕：開始練習 + 複製到我的單字卡集 */}
      <div className="flex gap-2">
        {set.accessCode && (
          <Link
            href={`/vocab/${set.accessCode}`}
            className="flex-1 rounded-lg bg-amber-500 py-2.5 text-center text-sm font-semibold text-white transition-all hover:bg-amber-500/90"
          >
            開始練習
          </Link>
        )}
        <button
          type="button"
          onClick={handleCopy}
          disabled={isPending || copied}
          className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all ${
            copied
              ? 'bg-green-100 text-green-700'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          } disabled:opacity-50`}
        >
          {copied ? '✅ 已複製！' : isPending ? '複製中…' : '複製到我的單字卡集'}
        </button>
      </div>
    </div>
  );
}
