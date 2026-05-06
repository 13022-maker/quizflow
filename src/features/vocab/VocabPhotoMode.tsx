'use client';

/**
 * VocabPhotoMode — /dashboard/vocab/new 拍照模式 client 元件
 *
 * 三階段 chained pipeline:
 *   stage 1 'input'          → 上傳照片(手機 input capture 喚起相機)+ 難度
 *      ↓ client 端 canvas 壓縮到 jpeg 0.7 quality
 *      ↓ POST /api/ai/generate-vocab-from-image (扣 1 quota)
 *   stage 2 'words-preview'  → words 列表勾選(同 VocabTopicMode 邏輯)
 *      ↓ POST /api/ai/generate-flashcards (沒 quota check)
 *   stage 3 'cards-preview'  → cards 預覽含音標 + title 編輯
 *      ↓ createVocabSet → /dashboard/vocab
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

// 用 canvas 把使用者上傳的照片壓縮到 jpeg(0.7 quality, 最大邊 1600px)
// 同時把 HEIC 等 iPhone 格式統一轉 jpeg,避免 server 端 Gemini 不認識
async function compressImage(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('圖檔讀取失敗,請換一張'));
      el.src = url;
    });

    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('瀏覽器不支援圖片壓縮');
    }
    ctx.drawImage(img, 0, 0, w, h);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('圖片壓縮失敗'))),
        'image/jpeg',
        0.7,
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function VocabPhotoMode() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('input');
  const [error, setError] = useState<string | null>(null);

  // stage 1
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [isGeneratingWords, setIsGeneratingWords] = useState(false);

  // stage 2
  const [title, setTitle] = useState('');
  const [words, setWords] = useState<Word[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isGeneratingCards, setIsGeneratingCards] = useState(false);

  // stage 3
  const [cards, setCards] = useState<Card[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setError(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
  };

  const handleGenerateWords = async () => {
    if (!file) {
      setError('請先選擇或拍照');
      return;
    }
    setIsGeneratingWords(true);
    setError(null);
    try {
      const compressed = await compressImage(file);
      const formData = new FormData();
      formData.append('image', compressed, 'photo.jpg');
      formData.append('difficulty', difficulty);

      const res = await fetch('/api/ai/generate-vocab-from-image', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.upgradeRequired) {
          setError('AI 配額已用完。免費方案每月 10 次,升級 Pro 解鎖無限。');
        } else {
          throw new Error(data.error ?? '辨識失敗');
        }
        return;
      }
      const list = (data.words ?? []) as Word[];
      setTitle(data.title ?? '拍照單字卡');
      setWords(list);
      setSelected(new Set(list.map((_, i) => i)));
      setStage('words-preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : '辨識失敗');
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
      {/* Stage 1: 上傳照片 */}
      {stage === 'input' && (
        <>
          <div>
            <label htmlFor="photo-input" className="mb-2 block text-sm font-medium">
              📷 上傳照片(手機會喚起相機)
            </label>
            <input
              id="photo-input"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="block w-full cursor-pointer rounded-xl border-2 border-dashed border-violet-200 bg-violet-50/30 px-4 py-6 text-sm transition-colors hover:border-violet-400 hover:bg-violet-50"
            />
            {previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="預覽"
                className="mt-3 max-h-64 w-full rounded-xl object-contain"
              />
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              建議拍清晰、物件較多的場景(教室、廚房、市場…),AI 會挑出可教的單字
            </p>
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
            disabled={isGeneratingWords || !file}
            className="w-full"
          >
            {isGeneratingWords ? '辨識照片中…' : '✨ AI 辨識照片中的單字'}
          </Button>
        </>
      )}

      {/* Stage 2: 單字預覽 + 勾選 */}
      {stage === 'words-preview' && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">{title || '拍照單字卡'}</p>
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
              重新拍照
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
