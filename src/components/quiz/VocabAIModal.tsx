'use client';

/**
 * VocabAIModal — 單字記憶模式專用 AI 生成面板
 * 流程：輸入主題 → AI 生成中英單字對 → 預覽勾選 → 匯入為 short_answer 題
 *
 * 匯入格式（與 AIQuizModal 一致）：
 *   { type: 'short', question: 中文意思, answer: 英文單字, explanation?: 例句 }
 */

import { useState } from 'react';

type Difficulty = 'easy' | 'medium' | 'hard';

type Word = {
  english: string;
  chinese: string;
  example?: string;
};

type GeneratedQuestion = {
  type: 'short';
  question: string;
  answer: string;
  explanation?: string;
};

type Props = {
  defaultTopic?: string;
  onImport: (questions: GeneratedQuestion[], title: string) => void;
  onClose: () => void;
};

const DIFFICULTIES: { value: Difficulty; label: string; sub: string }[] = [
  { value: 'easy', label: '初級', sub: '國中 / 日常' },
  { value: 'medium', label: '中級', sub: '高中 / 英檢中級' },
  { value: 'hard', label: '進階', sub: '學測 / 多益 700+' },
];

const QUICK_TOPICS = [
  '國中常用 500 字',
  '高中學測核心單字',
  '全民英檢中級',
  '多益商務常見字',
  '旅遊英文',
  '日常生活用品',
];

export default function VocabAIModal({ defaultTopic = '', onImport, onClose }: Props) {
  const [topic, setTopic] = useState(defaultTopic);
  const [count, setCount] = useState(15);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [words, setWords] = useState<Word[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const handleGenerate = async () => {
    if (!topic.trim()) {
      setError('請輸入單字主題');
      return;
    }
    setIsGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/generate-vocab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, count, difficulty }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? '生成失敗');
      }
      const list = (data.words ?? []) as Word[];
      setTitle(data.title ?? '');
      setWords(list);
      setSelected(new Set(list.map((_, i) => i)));
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失敗');
    } finally {
      setIsGenerating(false);
    }
  };

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) {
        next.delete(i);
      } else {
        next.add(i);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === words.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(words.map((_, i) => i)));
    }
  };

  const handleImport = () => {
    const picked = words
      .filter((_, i) => selected.has(i))
      .map<GeneratedQuestion>(w => ({
        type: 'short',
        question: w.chinese,
        answer: w.english,
        explanation: w.example,
      }));
    if (picked.length === 0) {
      setError('請至少勾選一個單字');
      return;
    }
    onImport(picked, title || '單字記憶');
  };

  const hasResults = words.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-bold">🔤 AI 生成單字清單</h2>
            <p className="text-xs text-muted-foreground">根據主題自動挑選單字，匯入後可立即練習</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {!hasResults
            ? (
                <div className="space-y-5">
                  {/* 主題 */}
                  <div>
                    <label htmlFor="vocab-topic" className="mb-2 block text-sm font-medium">單字主題</label>
                    <input
                      id="vocab-topic"
                      type="text"
                      value={topic}
                      onChange={e => setTopic(e.target.value)}
                      placeholder="例：旅遊英文、多益商務字、高中學測核心單字…"
                      className="w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {QUICK_TOPICS.map(q => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => setTopic(q)}
                          className="rounded-full border bg-muted/50 px-3 py-1 text-xs hover:border-primary hover:bg-primary/5"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 數量 */}
                  <div>
                    <label className="mb-2 block text-sm font-medium">
                      單字數量：
                      <span className="font-bold text-primary">{count}</span>
                    </label>
                    <input
                      type="range"
                      min={5}
                      max={30}
                      step={5}
                      value={count}
                      onChange={e => setCount(Number(e.target.value))}
                      className="w-full"
                    />
                    <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                      <span>5</span>
                      <span>15</span>
                      <span>30</span>
                    </div>
                  </div>

                  {/* 難度 */}
                  <div>
                    <p className="mb-2 block text-sm font-medium">難度</p>
                    <div className="grid grid-cols-3 gap-2">
                      {DIFFICULTIES.map(d => (
                        <button
                          key={d.value}
                          type="button"
                          onClick={() => setDifficulty(d.value)}
                          className={`rounded-lg border-2 px-3 py-2 text-sm transition ${
                            difficulty === d.value
                              ? 'border-primary bg-primary/5 text-primary'
                              : 'border-transparent bg-muted/50 hover:border-muted-foreground/20'
                          }`}
                        >
                          <div className="font-semibold">{d.label}</div>
                          <div className="text-xs text-muted-foreground">{d.sub}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {error && (
                    <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
                  )}
                </div>
              )
            : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">{title || '單字記憶'}</p>
                      <p className="text-xs text-muted-foreground">
                        已勾選
                        {' '}
                        {selected.size}
                        {' '}
                        /
                        {' '}
                        {words.length}
                        {' '}
                        個單字
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={toggleAll}
                      className="text-xs text-primary hover:underline"
                    >
                      {selected.size === words.length ? '全部取消' : '全選'}
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {words.map((w, i) => (
                      <label
                        key={w.english}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border-2 p-3 transition ${
                          selected.has(i)
                            ? 'border-primary bg-primary/5'
                            : 'border-transparent bg-muted/40'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(i)}
                          onChange={() => toggle(i)}
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <div className="flex items-baseline gap-3">
                            <span className="font-mono text-base font-semibold">{w.english}</span>
                            <span className="text-sm text-muted-foreground">{w.chinese}</span>
                          </div>
                          {w.example && (
                            <p className="mt-0.5 text-xs italic text-muted-foreground">{w.example}</p>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>

                  {error && (
                    <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
                  )}
                </div>
              )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t bg-muted/30 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm hover:bg-muted"
          >
            取消
          </button>
          {!hasResults
            ? (
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={isGenerating || !topic.trim()}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {isGenerating ? '生成中…' : '✨ AI 生成單字'}
                </button>
              )
            : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setWords([]);
                      setSelected(new Set());
                      setTitle('');
                    }}
                    className="rounded-lg border px-4 py-2 text-sm hover:bg-muted"
                  >
                    重新生成
                  </button>
                  <button
                    type="button"
                    onClick={handleImport}
                    disabled={selected.size === 0}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    匯入
                    {' '}
                    {selected.size}
                    {' '}
                    個單字
                  </button>
                </>
              )}
        </div>
      </div>
    </div>
  );
}
