'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';

type VocabCard = {
  front: string;
  back: string;
  example: string;
  phonetic: string;
};

type Props = {
  onImport: (questions: Array<{
    type: string;
    body: string;
    options: Array<{ id: string; text: string }>;
    correctAnswers: string[];
    points: number;
  }>) => void;
  onClose: () => void;
};

export default function VocabCardModal({ onImport, onClose }: Props) {
  const [words, setWords] = useState('');
  const [loading, setLoading] = useState(false);
  const [cards, setCards] = useState<VocabCard[]>([]);
  const [error, setError] = useState('');
  const [previewIndex, setPreviewIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const handleGenerate = async () => {
    if (!words.trim()) return;
    setLoading(true);
    setError('');
    setCards([]);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = () => {
    const questions = cards.map((card, i) => ({
      type: 'short_answer' as const,
      body: `${card.front}${card.phonetic ? ` ${card.phonetic}` : ''}`,
      options: [] as Array<{ id: string; text: string }>,
      correctAnswers: [card.back],
      points: Math.floor(100 / cards.length) + (i === cards.length - 1 ? 100 % cards.length : 0),
    }));
    onImport(questions);
    onClose();
  };

  const previewCard = cards[previewIndex];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        {/* 標題 */}
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold">AI 生成單字卡</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {cards.length === 0
          ? (
              <>
                {/* 輸入區 */}
                <div className="mb-4">
                  <label className="mb-2 block text-sm font-medium text-gray-700">
                    輸入單字清單
                  </label>
                  <textarea
                    value={words}
                    onChange={e => setWords(e.target.value)}
                    placeholder={'每行一個單字，例如：\napple\nbanana\nstrawberry\n\n或用逗號分隔：apple, banana, strawberry'}
                    rows={6}
                    className="w-full resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm placeholder:text-gray-300 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>

                {error && (
                  <p className="mb-4 text-sm text-red-500">{error}</p>
                )}

                <Button
                  onClick={handleGenerate}
                  disabled={loading || !words.trim()}
                  className="w-full"
                >
                  {loading ? '生成中…' : '生成單字卡'}
                </Button>
              </>
            )
          : (
              <>
                {/* 預覽卡片 */}
                <div className="mb-4">
                  <p className="mb-2 text-center text-sm text-gray-500">
                    預覽
                    {' '}
                    {previewIndex + 1}
                    {' '}
                    /
                    {' '}
                    {cards.length}
                    {' '}
                    張（點擊翻牌）
                  </p>

                  <div
                    className="cursor-pointer"
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
                        className="rounded-xl border-2 border-blue-100 bg-gradient-to-br from-blue-50 to-white p-6 text-center shadow-sm"
                        style={{ backfaceVisibility: 'hidden' }}
                      >
                        <p className="text-2xl font-bold text-gray-800">{previewCard?.front}</p>
                        {previewCard?.phonetic && (
                          <p className="mt-1 text-sm text-gray-400">{previewCard.phonetic}</p>
                        )}
                        <p className="mt-3 text-xs text-gray-300">點擊翻牌</p>
                      </div>

                      {/* 背面 */}
                      <div
                        className="absolute inset-0 rounded-xl border-2 border-green-100 bg-gradient-to-br from-green-50 to-white p-6 text-center shadow-sm"
                        style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
                      >
                        <p className="text-xl font-bold text-green-700">{previewCard?.back}</p>
                        {previewCard?.example && (
                          <p className="mt-3 text-sm italic text-gray-500">{previewCard.example}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 預覽導覽 */}
                  <div className="mt-3 flex justify-center gap-2">
                    <button
                      disabled={previewIndex === 0}
                      onClick={() => { setPreviewIndex(prev => prev - 1); setFlipped(false); }}
                      className="rounded px-3 py-1 text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                    >
                      ← 上一張
                    </button>
                    <button
                      disabled={previewIndex === cards.length - 1}
                      onClick={() => { setPreviewIndex(prev => prev + 1); setFlipped(false); }}
                      className="rounded px-3 py-1 text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                    >
                      下一張 →
                    </button>
                  </div>
                </div>

                {/* 動作按鈕 */}
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => { setCards([]); setFlipped(false); }}
                  >
                    重新生成
                  </Button>
                  <Button className="flex-1" onClick={handleImport}>
                    匯入
                    {' '}
                    {cards.length}
                    {' '}
                    張卡片
                  </Button>
                </div>
              </>
            )}
      </div>
    </div>
  );
}
