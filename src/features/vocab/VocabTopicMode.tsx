'use client';

/**
 * VocabTopicMode — /dashboard/vocab/new 主題模式 client 元件
 *
 * 三階段 chained pipeline:
 *   stage 1 'input'          → 使用者輸入 topic + count + difficulty
 *      ↓ POST /api/ai/generate-vocab     (扣 1 次 quota)
 *   stage 2 'words-preview'  → 預覽 words 列表,checkbox 勾選
 *      ↓ POST /api/ai/generate-flashcards (沒 quota check)
 *   stage 3 'cards-preview'  → 預覽 cards (含音標),title 可編輯
 *      ↓ createVocabSet server action
 *   redirect /dashboard/vocab
 *
 * 跟 VocabAIModal 不抽共用元件:那支綁在 QuizEditor 匯入流程,接觸面風險高
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createVocabSet } from '@/actions/vocabActions';
import { Button } from '@/components/ui/button';

type Difficulty = 'easy' | 'medium' | 'hard';

type Word = {
  english: string;
  chinese: string;
  example?: string;
};

type Card = {
  front: string;
  back: string;
  example: string;
  phonetic: string;
};

type Stage = 'input' | 'words-preview' | 'cards-preview';

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

export function VocabTopicMode({ initialTopic = '' }: { initialTopic?: string }) {
  const router = useRouter();

  // 共用 state
  const [stage, setStage] = useState<Stage>('input');
  const [error, setError] = useState<string | null>(null);

  // stage 1 input
  const [topic, setTopic] = useState(initialTopic);
  const [count, setCount] = useState(15);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [isGeneratingWords, setIsGeneratingWords] = useState(false);

  // stage 2 words preview
  const [title, setTitle] = useState('');
  const [words, setWords] = useState<Word[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isGeneratingCards, setIsGeneratingCards] = useState(false);

  // stage 3 cards preview
  const [cards, setCards] = useState<Card[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const handleGenerateWords = async () => {
    if (!topic.trim()) {
      setError('請輸入單字主題');
      return;
    }
    setIsGeneratingWords(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/generate-vocab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, count, difficulty }),
      });
      const data = await res.json();
      if (!res.ok) {
        // quota 超額 → 引導升級
        if (data.upgradeRequired) {
          setError('AI 配額已用完。免費方案每月 10 次,升級 Pro 解鎖無限。');
        } else {
          throw new Error(data.error ?? '生成失敗');
        }
        return;
      }
      const list = (data.words ?? []) as Word[];
      setTitle(data.title ?? topic);
      setWords(list);
      setSelected(new Set(list.map((_, i) => i)));
      setStage('words-preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失敗');
    } finally {
      setIsGeneratingWords(false);
    }
  };

  const toggleWord = (i: number) => {
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

  const handleGenerateCards = async () => {
    if (selected.size === 0) {
      setError('請至少勾選一個單字');
      return;
    }
    const wordsToCard = words
      .filter((_, i) => selected.has(i))
      .map(w => w.english)
      .join('\n');
    setIsGeneratingCards(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/generate-flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: wordsToCard }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? '生成卡片失敗');
      }
      setCards((data.cards ?? []) as Card[]);
      setStage('cards-preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成卡片失敗');
    } finally {
      setIsGeneratingCards(false);
    }
  };

  const handleSave = async () => {
    if (!title.trim() || cards.length === 0) {
      setError('請輸入卡集名稱');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      // createVocabSet 成功時 redirect /dashboard/vocab(throw NEXT_REDIRECT,不會 return)
      await createVocabSet({
        title: title.trim(),
        cards: cards.map(c => ({
          front: c.front,
          back: c.back,
          phonetic: c.phonetic || undefined,
          example: c.example || undefined,
        })),
      });
    } catch (e) {
      // NEXT_REDIRECT 是 normal control flow,不該 catch 顯示;只在真錯誤時顯示
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('NEXT_REDIRECT')) {
        return;
      }
      setError(msg || '儲存失敗');
      setIsSaving(false);
    }
  };

  const resetToInput = () => {
    setStage('input');
    setWords([]);
    setSelected(new Set());
    setCards([]);
    setError(null);
  };

  return (
    <div className="space-y-6">
      {/* Stage 1: 輸入主題 */}
      {stage === 'input' && (
        <>
          <div>
            <label htmlFor="topic-input" className="mb-2 block text-sm font-medium">單字主題</label>
            <input
              id="topic-input"
              type="text"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="例:旅遊英文、多益商務字、高中學測核心單字…"
              className="w-full rounded-xl border bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-violet-400"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK_TOPICS.map(q => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setTopic(q)}
                  className="rounded-full border bg-muted/50 px-3 py-1 text-xs hover:border-violet-400 hover:bg-violet-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">
              單字數量:
              <span className="font-bold text-violet-600">{count}</span>
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
                      ? 'border-violet-500 bg-violet-50 text-violet-700'
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
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
              {error.includes('AI 配額') && (
                <button
                  type="button"
                  onClick={() => router.push('/dashboard/billing')}
                  className="ml-2 underline"
                >
                  立即升級
                </button>
              )}
            </div>
          )}

          <Button
            onClick={handleGenerateWords}
            disabled={isGeneratingWords || !topic.trim()}
            className="w-full"
          >
            {isGeneratingWords ? '生成單字中…' : '✨ AI 生成單字清單'}
          </Button>
        </>
      )}

      {/* Stage 2: 單字預覽 + 勾選 */}
      {stage === 'words-preview' && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">{title || '單字記憶'}</p>
              <p className="text-xs text-muted-foreground">
                已勾選
                {' '}
                {selected.size}
                {' / '}
                {words.length}
                {' 個單字'}
              </p>
            </div>
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs text-violet-600 hover:underline"
            >
              {selected.size === words.length ? '全部取消' : '全選'}
            </button>
          </div>

          <div className="max-h-96 space-y-1.5 overflow-y-auto">
            {words.map((w, i) => (
              <label
                key={w.english}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border-2 p-3 transition ${
                  selected.has(i)
                    ? 'border-violet-500 bg-violet-50'
                    : 'border-transparent bg-muted/40'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(i)}
                  onChange={() => toggleWord(i)}
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

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={resetToInput}
              className="flex-1"
            >
              重新生成
            </Button>
            <Button
              type="button"
              onClick={handleGenerateCards}
              disabled={isGeneratingCards || selected.size === 0}
              className="flex-1"
            >
              {isGeneratingCards ? '補音標中…' : `下一步:補音標+例句(${selected.size})`}
            </Button>
          </div>
        </>
      )}

      {/* Stage 3: 卡片預覽 + 命名 + 儲存 */}
      {stage === 'cards-preview' && (
        <>
          <div>
            <label className="mb-1 block text-sm font-medium">
              卡集名稱
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="卡集名稱"
                className="mt-1 w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
            </label>
          </div>

          <p className="text-xs text-muted-foreground">
            共
            {' '}
            {cards.length}
            {' '}
            張卡片(已含 KK 音標 + 例句)
          </p>

          <div className="max-h-96 space-y-2 overflow-y-auto rounded-xl bg-muted/20 p-3">
            {cards.map(c => (
              <div
                key={c.front}
                className="rounded-lg bg-white p-3 shadow-sm"
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-base font-semibold">{c.front}</span>
                  <span className="text-xs text-violet-600">{c.phonetic}</span>
                </div>
                <p className="mt-1 text-sm">{c.back}</p>
                {c.example && (
                  <p className="mt-0.5 text-xs italic text-muted-foreground">{c.example}</p>
                )}
              </div>
            ))}
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStage('words-preview')}
              className="flex-1"
            >
              ← 返回修改
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !title.trim() || cards.length === 0}
              className="flex-1"
            >
              {isSaving ? '儲存中…' : `💾 儲存卡集(${cards.length} 張)`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
