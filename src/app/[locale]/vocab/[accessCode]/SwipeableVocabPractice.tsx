'use client';

import { useRef } from 'react';

import {
  type FlashcardLang,
  type RatingAction,
  SwipeableFlashcard,
} from '@/components/flashcard/SwipeableFlashcard';
import { mapToFlashcardDataList, type VocabCardRow } from '@/lib/flashcard';

type Props = {
  title: string;
  cards: VocabCardRow[];
};

// 三語 → 既有 /api/ai/tts 的 voice 對應
const VOICE_MAP: Record<FlashcardLang, string> = {
  zh: 'zh-tw-female',
  en: 'en-female',
  hak: 'hak',
};

export function SwipeableVocabPractice({ title, cards }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const flashcards = mapToFlashcardDataList(cards);

  const playAudio = async (text: string, lang: FlashcardLang) => {
    if (!text) {
      return;
    }
    try {
      const res = await fetch('/api/ai/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: VOICE_MAP[lang], speed: 'normal' }),
      });
      if (!res.ok) {
        return;
      }
      const { url } = await res.json();
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.play();
    } catch {
      // 音訊失敗靜默忽略，UI 不阻擋作答
    }
  };

  const handleRate = (cardId: string, action: RatingAction) => {
    // SRS 寫入：vocab_attempts 表尚未建立，先 log。等 schema 擴充再串 server action。
    // eslint-disable-next-line no-console
    console.log('[SRS]', { cardId, action });
  };

  return (
    <SwipeableFlashcard
      cards={flashcards}
      title={title}
      onPlayAudio={playAudio}
      onRate={handleRate}
    />
  );
}
