'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';

import { createVocabSet } from '@/actions/vocabActions';
import { Button } from '@/components/ui/button';
import { VocabTopicMode } from '@/features/vocab/VocabTopicMode';

type VocabCard = {
  front: string;
  back: string;
  example: string;
  phonetic: string;
};

function SpeakerButton({ text }: { text: string }) {
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleSpeak = useCallback(async () => {
    if (loading) {
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/ai/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: 'en-female', speed: 'normal' }),
      });
      if (!res.ok) {
        throw new Error('TTS 失敗');
      }
      const { url } = await res.json();
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.play();
    } catch {
      // 靜默
    } finally {
      setLoading(false);
    }
  }, [text, loading]);

  return (
    <button
      type="button"
      onClick={handleSpeak}
      className="inline-flex items-center gap-1 rounded-full bg-blue-50 p-2 text-blue-600 transition-colors hover:bg-blue-100"
      title="朗讀"
    >
      {loading
        ? (
            <svg className="size-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )
        : (
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
            </svg>
          )}
    </button>
  );
}

export default function NewVocabPage() {
  // 來自市集 CTA → ?topic=... 進主題模式;?title=... 進單字清單模式預填卡集名稱(向後相容);無 query → 單字清單模式
  const searchParams = useSearchParams();
  const initialTopic = searchParams.get('topic') ?? '';
  const initialTitle = searchParams.get('title') ?? '';
  const [mode, setMode] = useState<'topic' | 'words'>(initialTopic ? 'topic' : 'words');
  const [title, setTitle] = useState(initialTitle);
  const [words, setWords] = useState('');
  const [cards, setCards] = useState<VocabCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [previewIndex, setPreviewIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const handleGenerate = async () => {
    if (!words.trim()) {
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/ai/generate-flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: words.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '生成失敗');
      }
      const { cards: generated } = await res.json();
      setCards(generated);
      setPreviewIndex(0);
      setFlipped(false);
      if (!title.trim()) {
        setTitle('單字練習');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失敗');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!title.trim() || cards.length === 0) {
      return;
    }
    setSaving(true);
    try {
      await createVocabSet({ title: title.trim(), cards });
    } catch {
      setError('儲存失敗');
      setSaving(false);
    }
  };

  const card = cards[previewIndex];

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <div className="mb-6">
        <Link href="/dashboard/vocab" className="text-sm text-muted-foreground hover:text-foreground">
          ← 返回單字卡集
        </Link>
        <h1 className="mt-2 text-xl font-bold">AI 生成單字卡</h1>
      </div>

      {/* Tab 切換:主題模式 vs 單字清單模式 */}
      <div className="mb-6 flex gap-2 border-b">
        <button
          type="button"
          onClick={() => setMode('topic')}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            mode === 'topic'
              ? 'border-violet-600 text-violet-600'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          🎯 主題模式
        </button>
        <button
          type="button"
          onClick={() => setMode('words')}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            mode === 'words'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          ✏️ 單字清單模式
        </button>
      </div>

      {/* 主題模式 — chained pipeline 由 VocabTopicMode 元件處理 */}
      {mode === 'topic' && <VocabTopicMode initialTopic={initialTopic} />}

      {/* 單字清單模式 — 既有手動輸入流程,僅在 mode='words' 顯示 */}
      {mode === 'words' && (
        <>
          {/* 標題 */}
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium">
              卡集名稱
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="例如：Unit 3 單字"
                className="mt-1 w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </label>
          </div>

          {/* 輸入單字 */}
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium">
              輸入單字清單
              <textarea
                value={words}
                onChange={e => setWords(e.target.value)}
                placeholder={'每行一個單字，例如：\napple\nbanana\nstrawberry'}
                rows={5}
                className="mt-1 w-full resize-none rounded-xl border px-4 py-3 text-sm placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </label>
          </div>

          {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

          <Button onClick={handleGenerate} disabled={loading || !words.trim()} className="mb-6 w-full">
            {loading ? '生成中…' : '✨ AI 生成卡片'}
          </Button>
        </>
      )}

      {/* 預覽卡片 — 僅單字清單模式生成後顯示;切到主題模式則隱藏(避免兩種 flow 視覺打架) */}
      {mode === 'words' && cards.length > 0 && card && (
        <>
          <div className="mb-2 text-center text-sm text-muted-foreground">
            {previewIndex + 1}
            {' / '}
            {cards.length}
            {' 張'}
          </div>

          <div
            className="mb-3 cursor-pointer"
            style={{ perspective: '800px' }}
            onClick={() => setFlipped(prev => !prev)}
            role="button"
            tabIndex={0}
            onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setFlipped(prev => !prev)}
          >
            <div
              className="relative transition-transform duration-500"
              style={{
                transformStyle: 'preserve-3d',
                transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
              }}
            >
              {/* 正面 */}
              <div
                className="rounded-xl border-2 border-blue-100 bg-gradient-to-br from-blue-50 to-white p-8 text-center shadow-sm"
                style={{ backfaceVisibility: 'hidden' }}
              >
                <p className="text-3xl font-bold text-gray-800">{card.front}</p>
                {card.phonetic && (
                  <p className="mt-2 text-sm text-gray-400">{card.phonetic}</p>
                )}
                <div className="mt-3 flex justify-center">
                  <SpeakerButton text={card.front} />
                </div>
                <p className="mt-3 text-xs text-gray-300">點擊翻牌</p>
              </div>

              {/* 背面 */}
              <div
                className="absolute inset-0 rounded-xl border-2 border-green-100 bg-gradient-to-br from-green-50 to-white p-8 text-center shadow-sm"
                style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
              >
                <p className="text-2xl font-bold text-green-700">{card.back}</p>
                {card.example && (
                  <p className="mt-3 text-sm italic text-gray-500">{card.example}</p>
                )}
                <div className="mt-3 flex justify-center">
                  <SpeakerButton text={card.back} />
                </div>
              </div>
            </div>
          </div>

          {/* 導覽 */}
          <div className="mb-6 flex justify-center gap-2">
            <button
              type="button"
              disabled={previewIndex === 0}
              onClick={() => {
                setPreviewIndex(prev => prev - 1);
                setFlipped(false);
              }}
              className="rounded px-3 py-1 text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-30"
            >
              ←
            </button>
            <button
              type="button"
              disabled={previewIndex === cards.length - 1}
              onClick={() => {
                setPreviewIndex(prev => prev + 1);
                setFlipped(false);
              }}
              className="rounded px-3 py-1 text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-30"
            >
              →
            </button>
          </div>

          {/* 儲存 */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setCards([]);
                setFlipped(false);
              }}
            >
              重新生成
            </Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving || !title.trim()}>
              {saving ? '儲存中…' : `儲存 ${cards.length} 張卡片`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
