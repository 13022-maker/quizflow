'use client';

/**
 * AI 生成學科表單：呼叫 generateAdaptiveSubject（約 1～3 分鐘）。
 * 生成期間鎖住按鈕並顯示提示；成功後顯示摘要並提供「回去建立練習」入口。
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { generateAdaptiveSubject } from '@/actions/adaptiveActions';

type Result = {
  id: number;
  name: string;
  knowledgeCount: number;
  itemCount: number;
};

export function NewSubjectForm() {
  const router = useRouter();
  const [topic, setTopic] = useState('');
  const [material, setMaterial] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function submit() {
    if (!topic.trim() || generating) {
      return;
    }
    setGenerating(true);
    setError(null);
    setResult(null);
    try {
      const res = await generateAdaptiveSubject({
        topic: topic.trim(),
        material: material.trim() || undefined,
      });
      setResult(res);
      router.refresh(); // 讓清單頁的學科下拉即時更新
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  // 生成成功：顯示摘要
  if (result) {
    return (
      <div className="rounded-lg border p-6">
        <h2 className="text-lg font-semibold">✅ 學科已生成</h2>
        <p className="mt-2 text-sm">
          <strong>{result.name}</strong>
          {' '}
          — 共
          {' '}
          {result.knowledgeCount}
          {' '}
          個知識點、
          {result.itemCount}
          {' '}
          道題目。
        </p>
        <div className="mt-4 flex gap-2">
          <Link
            href="/dashboard/adaptive"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            用它建立練習 →
          </Link>
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setTopic('');
              setMaterial('');
            }}
            className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            再生成一個
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-6">
      <div className="flex flex-col gap-1">
        <label htmlFor="subject-topic" className="text-sm font-medium">單元主題</label>
        <input
          id="subject-topic"
          value={topic}
          onChange={e => setTopic(e.target.value)}
          maxLength={100}
          disabled={generating}
          placeholder="例如：二次函數、Python 字典、細胞分裂"
          className="h-10 rounded-md border px-3 text-sm"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="subject-material" className="text-sm font-medium">
          教材內容（選填）
        </label>
        <textarea
          id="subject-material"
          value={material}
          onChange={e => setMaterial(e.target.value)}
          maxLength={20000}
          disabled={generating}
          rows={6}
          placeholder="貼上課本段落或講義文字，AI 會依此劃分知識點與出題範圍（不填則依主題自由發揮）。"
          className="rounded-md border px-3 py-2 text-sm"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600">
          ⚠️
          {' '}
          {error}
        </p>
      )}

      {generating && (
        <p className="text-sm text-muted-foreground">
          ⏳ AI 正在設計知識圖譜與題目，約需 1～3 分鐘，請不要關閉此頁…
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={generating || !topic.trim()}
        className="h-10 rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {generating ? '生成中…' : '✨ 開始生成'}
      </button>
    </div>
  );
}
