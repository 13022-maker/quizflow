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
 *   - en.word     ← front/back 中「看起來是英文」的那個（皆非英文時退回 back）
 *   - cross.en    ← 同上，但皆非英文時留空（背面 EN 列會自動隱藏）
 *     註：back 多為「中文解釋」而非英文翻譯，不能直接當 EN 對照（伺服器 → 提供服務的電腦或程式。）
 *   - hak         ← 留空、tts: false（客語語音先 disable）
 *   - cross.hak   ← 留空
 *
 * 客語、閩南語的真實資料等之後 schema 擴充後再從這裡接。
 */
// 有拉丁字母、且沒有中日韓字元，才視為英文
export function looksEnglish(text: string | null | undefined): boolean {
  if (!text) {
    return false;
  }
  return /[a-z]/i.test(text) && !/[\u3400-\u9FFF\uF900-\uFAFF]/.test(text);
}

export function mapToFlashcardData(row: VocabCardRow): FlashcardData {
  const english = looksEnglish(row.back) ? row.back : looksEnglish(row.front) ? row.front : '';
  return {
    id: String(row.id),
    zh: {
      word: row.front,
      pron: row.phonetic ?? '',
      pill: '單字',
      tts: true,
    },
    en: {
      word: english || row.back,
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
      en: english,
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
