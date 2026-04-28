import type { FlashcardData } from '@/components/flashcard/SwipeableFlashcard';

// 現有 vocabulary_card schema 的欄位（src/models/Schema.ts:364）
// front / back 是單語對照（中→英居多），phonetic 為發音、example 為例句
export type VocabCardRow = {
  id: number | string;
  front: string;
  back: string;
  phonetic?: string | null;
  example?: string | null;
};

/**
 * 把現有 DB 的單字卡（front/back 單語）轉成 SwipeableFlashcard 需要的三語格式。
 *
 * 對應策略（暫定，等之後接多語 schema 再擴展）：
 *   - zh.word     ← front（題面，多為中文）
 *   - zh.pron     ← phonetic
 *   - meaning     ← back（翻牌後看到的意思）
 *   - en.word     ← back（如果 back 是英文翻譯）
 *   - hak         ← 留空、tts: false（客語語音先 disable）
 *   - cross.en/hak ← 同上
 *
 * 客語、閩南語的真實資料等之後 schema 擴充後再從這裡接。
 */
export function mapToFlashcardData(row: VocabCardRow): FlashcardData {
  return {
    id: String(row.id),
    zh: {
      word: row.front,
      pron: row.phonetic ?? '',
      pill: '單字',
      tts: true,
    },
    en: {
      word: row.back,
      pron: '',
      pill: 'WORD',
      tts: true,
    },
    hak: {
      word: '',
      pron: '',
      pill: '客語',
      tts: false,
    },
    meaning: row.back,
    example: row.example ?? '',
    cross: {
      en: row.back,
      hak: '',
    },
  };
}

/**
 * 批次轉換版本。
 */
export function mapToFlashcardDataList(rows: VocabCardRow[]): FlashcardData[] {
  return rows.map(mapToFlashcardData);
}
