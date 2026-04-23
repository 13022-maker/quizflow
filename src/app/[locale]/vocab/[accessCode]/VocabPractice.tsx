'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

type Card = {
  id: number;
  front: string;
  back: string;
  phonetic: string | null;
  phoneticPinyin: string | null;
  imageUrl: string | null;
  example: string | null;
};

const VOICE_OPTIONS = [
  { value: 'zh-tw-female', label: '國語' },
  { value: 'en-female', label: 'English' },
  { value: 'hak', label: '客語' },
];

const PHONETIC_OPTIONS = [
  { value: 'zhuyin', label: '注音' },
  { value: 'pinyin', label: '拼音' },
] as const;

type PhoneticMode = (typeof PHONETIC_OPTIONS)[number]['value'];

function SpeakerButton({
  text,
  voice,
  variant = 'pill',
}: {
  text: string;
  voice: string;
  variant?: 'pill' | 'icon';
}) {
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleSpeak = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
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
        body: JSON.stringify({ text, voice, speed: 'normal' }),
      });
      if (!res.ok) {
        throw new Error('TTS 失敗');
      }
      const { url } = await res.json();
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.play();
    } catch { /* 靜默失敗 */ } finally {
      setLoading(false);
    }
  }, [text, voice, loading]);

  const iconClass = variant === 'icon' ? 'size-4' : 'size-5';

  const baseClass = variant === 'icon'
    ? 'inline-flex size-8 items-center justify-center rounded-full bg-white text-indigo-600 shadow-sm ring-1 ring-indigo-100 transition-all hover:bg-indigo-50 hover:shadow'
    : 'inline-flex items-center justify-center rounded-full bg-white p-3 text-indigo-600 shadow-md ring-1 ring-indigo-100 transition-all hover:scale-105 hover:bg-indigo-50 active:scale-95';

  return (
    <button
      type="button"
      onClick={handleSpeak}
      className={baseClass}
      title="朗讀發音"
      aria-label="朗讀發音"
    >
      {loading
        ? (
            <svg className={`${iconClass} animate-spin`} fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )
        : (
            <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
            </svg>
          )}
    </button>
  );
}

export function VocabPractice({ title, cards }: { title: string; cards: Card[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [knownIds, setKnownIds] = useState<Set<number>>(new Set());
  const [finished, setFinished] = useState(false);
  const [voice, setVoice] = useState('zh-tw-female');
  const [phoneticMode, setPhoneticMode] = useState<PhoneticMode>('zhuyin');

  const card = cards[currentIndex]!;

  const phoneticText = useMemo(() => {
    if (phoneticMode === 'pinyin' && card.phoneticPinyin) {
      return card.phoneticPinyin;
    }
    if (phoneticMode === 'zhuyin' && card.phonetic) {
      return card.phonetic;
    }
    return card.phonetic ?? card.phoneticPinyin ?? '';
  }, [phoneticMode, card.phonetic, card.phoneticPinyin]);

  const hasBothPhonetics = Boolean(card.phonetic && card.phoneticPinyin);

  const handleNext = (known: boolean) => {
    if (known) {
      setKnownIds(prev => new Set(prev).add(card.id));
    }
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
    const pct = Math.round((knownIds.size / cards.length) * 100);
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm overflow-hidden rounded-3xl bg-white/90 shadow-xl ring-1 ring-white/60 backdrop-blur">
          <div className="bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 p-8 text-center text-white">
            <p className="text-5xl">🎉</p>
            <p className="mt-3 text-xl font-bold">練習完畢！</p>
            <p className="mt-1 text-sm text-white/80">
              共
              {' '}
              {cards.length}
              {' '}
              張，記住
              {' '}
              {knownIds.size}
              {' '}
              張
            </p>
          </div>
          <div className="p-6 text-center">
            <div className="text-5xl font-black tracking-tight text-indigo-600">
              {pct}
              <span className="text-2xl font-bold text-indigo-400">%</span>
            </div>
            <p className="mt-1 text-xs text-gray-400">記憶率</p>
            <button
              onClick={handleRestart}
              type="button"
              className="mt-6 w-full rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-200 transition-all hover:shadow-xl active:scale-[0.98]"
            >
              再練一次
            </button>
          </div>
        </div>
      </div>
    );
  }

  const rememberedRatio = (knownIds.size / cards.length) * 100;
  const progressRatio = ((currentIndex + 1) / cards.length) * 100;

  return (
    <div className="flex min-h-screen flex-col items-center p-4 pt-6">
      {/* 標題 */}
      <div className="mx-auto w-full max-w-sm">
        <h1 className="mb-3 text-center text-lg font-bold tracking-tight text-gray-800">
          {title}
        </h1>

        {/* 發音語言切換 */}
        <div className="mb-2 flex justify-center gap-1.5">
          {VOICE_OPTIONS.map(v => (
            <button
              key={v.value}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setVoice(v.value);
              }}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${
                voice === v.value
                  ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-200'
                  : 'bg-white/80 text-gray-500 ring-1 ring-gray-200 hover:bg-white hover:text-gray-700'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        {/* 拼音 / 注音切換（中文卡片才顯示） */}
        {hasBothPhonetics && (
          <div className="mb-3 flex justify-center gap-1">
            {PHONETIC_OPTIONS.map(p => (
              <button
                key={p.value}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPhoneticMode(p.value);
                }}
                className={`rounded-full px-3 py-0.5 text-[11px] font-medium transition-all ${
                  phoneticMode === p.value
                    ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200'
                    : 'bg-white/70 text-gray-400 ring-1 ring-gray-200 hover:text-gray-600'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {/* 頁數 + 記住數 + 發音鍵 同列 */}
        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-gray-500">
            {currentIndex + 1}
            {' '}
            /
            {' '}
            {cards.length}
          </span>

          <SpeakerButton text={card.front} voice={voice} variant="icon" />

          <span className="font-semibold text-gray-500">
            記住
            {' '}
            <span className="text-indigo-600">{knownIds.size}</span>
            {' '}
            張
          </span>
        </div>

        {/* 進度條 */}
        <div className="relative h-2 overflow-hidden rounded-full bg-white/70 ring-1 ring-gray-100">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 shadow-sm transition-all duration-300"
            style={{ width: `${progressRatio}%` }}
          />
          {rememberedRatio > 0 && (
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-emerald-400/70"
              style={{ width: `${rememberedRatio}%` }}
            />
          )}
        </div>
      </div>

      {/* 卡片 */}
      <div className="mx-auto mt-5 w-full max-w-sm">
        <div
          className="cursor-pointer"
          style={{ perspective: '1200px' }}
          onClick={() => setFlipped(prev => !prev)}
          role="button"
          tabIndex={0}
          onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setFlipped(prev => !prev)}
        >
          <div
            className="relative transition-transform duration-500 ease-out"
            style={{
              transformStyle: 'preserve-3d',
              transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
            }}
          >
            {/* 正面 */}
            <div
              className="relative flex min-h-[340px] flex-col overflow-hidden rounded-3xl bg-white p-6 shadow-2xl shadow-indigo-100/50 ring-1 ring-white/80"
              style={{ backfaceVisibility: 'hidden' }}
            >
              {/* 漸層裝飾背景 */}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-indigo-50/60 via-white to-violet-50/40" />
              <div className="pointer-events-none absolute -right-8 -top-8 size-32 rounded-full bg-gradient-to-br from-indigo-200/50 to-violet-200/30 blur-2xl" />
              <div className="pointer-events-none absolute -bottom-12 -left-8 size-40 rounded-full bg-gradient-to-tr from-fuchsia-200/40 to-pink-200/30 blur-3xl" />

              <div className="relative flex flex-1 flex-col items-center justify-center">
                {/* 圖片 */}
                {card.imageUrl && (
                  <div className="mb-3 w-full overflow-hidden rounded-2xl bg-gray-50 ring-1 ring-gray-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={card.imageUrl}
                      alt={card.front}
                      className="h-32 w-full object-cover"
                    />
                  </div>
                )}

                <p className="text-center text-4xl font-black tracking-tight text-gray-800">
                  {card.front}
                </p>
                {phoneticText && (
                  <p className={`mt-2 text-center text-base font-medium tracking-wide text-gray-400 ${
                    phoneticMode === 'pinyin' ? 'italic' : ''
                  }`}
                  >
                    {phoneticText}
                  </p>
                )}

                <p className="mt-6 text-xs font-medium text-gray-300">點擊翻牌看答案</p>
              </div>
            </div>

            {/* 背面 */}
            <div
              className="absolute inset-0 flex min-h-[340px] flex-col overflow-hidden rounded-3xl bg-white p-6 shadow-2xl shadow-emerald-100/50 ring-1 ring-white/80"
              style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
            >
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-50/70 via-white to-teal-50/40" />
              <div className="pointer-events-none absolute -right-8 -top-8 size-32 rounded-full bg-gradient-to-br from-emerald-200/50 to-teal-200/30 blur-2xl" />

              <div className="relative flex flex-1 flex-col items-center justify-center">
                <p className="text-xs font-semibold uppercase tracking-widest text-emerald-500">
                  答案
                </p>
                <p className="mt-3 text-center text-3xl font-bold text-emerald-700">
                  {card.back}
                </p>
                {card.example && (
                  <p className="mt-4 max-w-xs text-center text-sm italic leading-relaxed text-gray-500">
                    “
                    {card.example}
                    ”
                  </p>
                )}
                <div className="mt-5">
                  <SpeakerButton text={card.front} voice={voice} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 按鈕 */}
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleNext(false);
            }}
            className="flex-1 rounded-2xl border-2 border-red-200 bg-white py-3.5 text-sm font-semibold text-red-500 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-red-50 hover:shadow-md active:scale-[0.98]"
          >
            不會
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleNext(true);
            }}
            className="flex-1 rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 py-3.5 text-sm font-semibold text-white shadow-lg shadow-emerald-200/70 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-emerald-200 active:scale-[0.98]"
          >
            會了
          </button>
        </div>
      </div>
    </div>
  );
}
