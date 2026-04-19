'use client';

import { useCallback, useRef, useState } from 'react';

type Card = {
  id: number;
  front: string;
  back: string;
  phonetic: string | null;
  example: string | null;
};

const VOICE_OPTIONS = [
  { value: 'zh-tw-female', label: '國語' },
  { value: 'en-female', label: 'English' },
  { value: 'hak', label: '客語' },
];

function SpeakerButton({ text, voice, size = 'md' }: { text: string; voice: string; size?: 'sm' | 'md' }) {
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleSpeak = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (loading) return;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setLoading(true);
    try {
      const res = await fetch('/api/ai/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice, speed: 'normal' }),
      });
      if (!res.ok) throw new Error();
      const { url } = await res.json();
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.play();
    } catch { /* */ } finally { setLoading(false); }
  }, [text, loading]);

  const iconSize = size === 'sm' ? 'size-4' : 'size-5';

  return (
    <button
      type="button"
      onClick={handleSpeak}
      className="inline-flex items-center justify-center rounded-full bg-white/80 p-2.5 text-blue-600 shadow-sm transition-all hover:bg-white hover:shadow-md"
      title="朗讀"
    >
      {loading
        ? <svg className={`${iconSize} animate-spin`} fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
        : <svg className={iconSize} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" /></svg>}
    </button>
  );
}

export function VocabPractice({ title, cards }: { title: string; cards: Card[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [knownIds, setKnownIds] = useState<Set<number>>(new Set());
  const [finished, setFinished] = useState(false);
  const [voice, setVoice] = useState('zh-tw-female');

  const card = cards[currentIndex]!;

  const handleNext = (known: boolean) => {
    if (known) setKnownIds(prev => new Set(prev).add(card.id));
    if (currentIndex < cards.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setFlipped(false);
    } else {
      setFinished(true);
    }
  };

  const handleRestart = () => {
    setCurrentIndex(0);
    setFlipped(false);
    setKnownIds(new Set());
    setFinished(false);
  };

  if (finished) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-lg">
          <p className="text-5xl">🎉</p>
          <p className="mt-4 text-xl font-bold">練習完畢！</p>
          <p className="mt-2 text-muted-foreground">
            共 {cards.length} 張，記住了 {knownIds.size} 張
          </p>
          <div className="mt-2 text-3xl font-bold text-blue-600">
            {Math.round((knownIds.size / cards.length) * 100)}%
          </div>
          <button
            onClick={handleRestart}
            className="mt-6 w-full rounded-xl bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-700"
          >
            再練一次
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col p-4 pt-6">
      {/* 標題 + 語言 + 進度 */}
      <div className="mx-auto mb-4 w-full max-w-sm">
        <h1 className="mb-2 text-center text-lg font-bold text-gray-800">{title}</h1>
        {/* 發音語言選擇 */}
        <div className="mb-3 flex justify-center gap-1">
          {VOICE_OPTIONS.map(v => (
            <button
              key={v.value}
              type="button"
              onClick={(e) => { e.stopPropagation(); setVoice(v.value); }}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                voice === v.value
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-white/70 text-gray-500 hover:bg-white'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="mb-1 flex justify-between text-xs text-gray-400">
          <span>{currentIndex + 1} / {cards.length}</span>
          <span>記住 {knownIds.size} 張</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/60">
          <div
            className="h-full rounded-full bg-blue-500 transition-all"
            style={{ width: `${((currentIndex + 1) / cards.length) * 100}%` }}
          />
        </div>
      </div>

      {/* 卡片 */}
      <div className="mx-auto w-full max-w-sm flex-1">
        <div
          className="cursor-pointer"
          style={{ perspective: '1000px' }}
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
              className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border-2 border-blue-100 bg-gradient-to-br from-blue-50 via-white to-blue-50 p-8 shadow-lg"
              style={{ backfaceVisibility: 'hidden' }}
            >
              <p className="text-4xl font-bold text-gray-800">{card.front}</p>
              {card.phonetic && (
                <p className="mt-2 text-base text-gray-400">{card.phonetic}</p>
              )}
              <div className="mt-4">
                <SpeakerButton text={card.front} voice={voice} />
              </div>
              <p className="mt-4 text-xs text-gray-300">點擊翻牌看答案</p>
            </div>

            {/* 背面 */}
            <div
              className="absolute inset-0 flex min-h-[280px] flex-col items-center justify-center rounded-2xl border-2 border-green-100 bg-gradient-to-br from-green-50 via-white to-green-50 p-8 shadow-lg"
              style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
            >
              <p className="text-3xl font-bold text-green-700">{card.back}</p>
              {card.example && (
                <p className="mt-4 max-w-xs text-center text-sm italic leading-relaxed text-gray-500">
                  {card.example}
                </p>
              )}
              <div className="mt-4">
                <SpeakerButton text={card.front} voice={voice} />
              </div>
            </div>
          </div>
        </div>

        {/* 按鈕 */}
        <div className="mt-6 flex gap-3">
          <button
            onClick={(e) => { e.stopPropagation(); handleNext(false); }}
            className="flex-1 rounded-xl border-2 border-red-200 bg-white py-3.5 text-sm font-semibold text-red-500 transition-all hover:bg-red-50"
          >
            不會
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleNext(true); }}
            className="flex-1 rounded-xl bg-green-600 py-3.5 text-sm font-semibold text-white transition-all hover:bg-green-700"
          >
            會了
          </button>
        </div>
      </div>
    </div>
  );
}
