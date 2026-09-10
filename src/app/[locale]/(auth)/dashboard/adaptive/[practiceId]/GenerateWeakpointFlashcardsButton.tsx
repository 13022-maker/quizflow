'use client';

import { useState } from 'react';

import { createVocabSet } from '@/actions/vocabActions';

type WeakConcept = { name: string; masteryPct: number };

/**
 * 「用 AI 生成弱點概念卡」按鈕：把全班掌握率偏低的知識點送 AI 生成概念卡，
 * 存成新的單字卡集（createVocabSet 成功時會 redirect /dashboard/vocab）。
 * 沒有弱點知識點（全班都還沒作答或都掌握良好）時停用，避免生出空卡集。
 */
export function GenerateWeakpointFlashcardsButton({
  subjectName,
  weakConcepts,
}: {
  subjectName: string;
  weakConcepts: WeakConcept[];
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/generate-weakpoint-flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectName, concepts: weakConcepts }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? '生成失敗');
      }

      // createVocabSet 成功時 redirect /dashboard/vocab（throw NEXT_REDIRECT，不會 return）
      await createVocabSet({
        title: data.title,
        cards: (data.cards as { front: string; back: string; example?: string }[]).map(c => ({
          front: c.front,
          back: c.back,
          example: c.example || undefined,
        })),
      });
    } catch (e) {
      // NEXT_REDIRECT 是正常的導頁流程，不該當成錯誤顯示；只在真的失敗時顯示
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('NEXT_REDIRECT')) {
        return;
      }
      setError(msg || '生成失敗');
      setIsLoading(false);
    }
  };

  if (weakConcepts.length === 0) {
    return (
      <span
        className="rounded-lg border px-3.5 py-2 text-sm font-medium text-muted-foreground/50"
        title="目前沒有掌握率低於 50% 的知識點"
      >
        ✨ 用 AI 生成弱點概念卡
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isLoading}
        className="rounded-lg bg-primary/10 px-3.5 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
      >
        {isLoading
          ? '生成中…'
          : `✨ 用 AI 生成弱點概念卡（${weakConcepts.length} 個弱點）`}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
