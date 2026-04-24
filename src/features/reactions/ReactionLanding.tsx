// 老師端入口頁：按一下開啟新頻道（產 PIN 後跳轉到主控台）
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { generateReactionPin } from '@/services/reactions/types';

export function ReactionLanding() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const handleStart = () => {
    setCreating(true);
    const pin = generateReactionPin();
    router.push(`/dashboard/reactions/${pin}`);
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <div className="rounded-2xl border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight">🎉 課堂即時回饋</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          上課中想知道學生跟得上嗎？開一個課堂頻道，給學生 6 碼 PIN 加入，
          他們就能匿名按 5 個 emoji 回饋你（懂了 / 模糊 / 有問題 / 太快 / 太慢）。
        </p>

        <ul className="mt-5 space-y-2 text-xs text-muted-foreground">
          <li>· 完全匿名（看不到誰按的）</li>
          <li>· 不存歷史，關閉頻道即消失</li>
          <li>· 可在實體課堂或視訊課用，不限測驗</li>
        </ul>

        <Button
          type="button"
          onClick={handleStart}
          disabled={creating}
          className="mt-6 h-12 w-full text-base font-semibold"
        >
          {creating ? '開啟中⋯' : '🎉 開啟新頻道'}
        </Button>
      </div>
    </div>
  );
}
