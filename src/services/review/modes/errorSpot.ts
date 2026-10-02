// error_spot（挑錯標註）題型：範例答案切成一句一句，老師標出哪幾句有錯，
// 學生點選他認為有錯的句子（可多選、也可都不選＝認為全對），以 F1 比對計分。
import { z } from 'zod';

import type { ModeScoreRow, ReviewModeHandler } from './types';

// 句尾標點：遇到就結束一句（標點留在句尾）
const TERMINATORS = new Set(['。', '！', '？', '；', '!', '?', ';']);
// 句尾標點之後，緊接著的這些字元仍歸在同一句（連續標點、刪節號、右引號／右括號）
const TRAILERS = new Set([...TERMINATORS, '…', '⋯', '.', '」', '』', '）', ')', '】', '》', '〉', '"', '\'', '”', '’']);

/**
 * 把範例答案切成句子（server / client 共用的純函式）。
 * - 以 。！？；!?; 與換行為界，標點留在句尾；連續標點（！？、……。）歸在同一句
 * - 每段 trim，空段丟掉；沒有任何標點時整段一句
 * - 英文句點「.」不當界線（避免切到 3.14 這類小數），但緊跟在句尾標點後的會併入
 */
export function splitSegments(content: string): string[] {
  const segments: string[] = [];
  let current = '';
  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) {
      segments.push(trimmed);
    }
    current = '';
  };

  const chars = Array.from(content);
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i]!;
    if (ch === '\n') {
      flush();
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
    if (TERMINATORS.has(ch)) {
      while (i < chars.length && TRAILERS.has(chars[i]!)) {
        current += chars[i];
        i += 1;
      }
      flush();
    }
  }
  flush();
  return segments;
}

// 不重複、遞增、非負整數的索引陣列
const sortedUniqueIndexes = (max: number) =>
  z
    .array(z.number().int('句子編號必須是整數').min(0, '句子編號不可為負數'))
    .max(max, `最多只能選 ${max} 句`)
    .refine(arr => arr.every((v, i) => i === 0 || v > arr[i - 1]!), '句子編號必須遞增且不可重複');

const RefSchema = z.object(
  { errorSegmentIndexes: sortedUniqueIndexes(200) },
  { required_error: '請點選這則答案中有錯的句子', invalid_type_error: '請點選這則答案中有錯的句子' },
);
const ResponseSchema = z.object(
  { selectedSegmentIndexes: sortedUniqueIndexes(50) },
  { required_error: '請先點選句子再送出', invalid_type_error: '請先點選句子再送出' },
);

export type ErrorSpotRef = z.infer<typeof RefSchema>;
export type ErrorSpotResponse = z.infer<typeof ResponseSchema>;
export type ErrorSpotClientData = { segments: string[] };

function refIndexes(refData: unknown): number[] {
  const parsed = RefSchema.safeParse(refData);
  return parsed.success ? parsed.data.errorSegmentIndexes : [];
}

// 學生作答：格式壞掉視為沒選；超出句數的索引忽略（server 驗證時不知道句數）
function selectedIndexes(row: ModeScoreRow, segmentCount: number): number[] {
  const parsed = ResponseSchema.safeParse(row.responseData);
  return parsed.success ? parsed.data.selectedSegmentIndexes.filter(i => i < segmentCount) : [];
}

/** 單一學生的 F1（0..1）；標準與作答都是空集合時算 1 */
export function calcF1(ref: number[], selected: number[]): number {
  if (ref.length === 0 && selected.length === 0) {
    return 1;
  }
  const refSet = new Set(ref);
  const hit = selected.filter(i => refSet.has(i)).length;
  const precision = selected.length === 0 ? 0 : hit / selected.length;
  const recall = ref.length === 0 ? 0 : hit / ref.length;
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function teamStats(content: string, refData: unknown, rows: ModeScoreRow[]) {
  const segmentCount = splitSegments(content).length;
  const ref = refIndexes(refData).filter(i => i < segmentCount);
  const picks = rows.map(r => selectedIndexes(r, segmentCount));
  const avgF1 = picks.reduce((a, p) => a + calcF1(ref, p), 0) / picks.length;
  const avgSelected = picks.reduce((a, p) => a + p.length, 0) / picks.length;
  return { ref, avgF1, avgSelected };
}

/** 1-based 顯示：[1, 3] → 「第 2、4 句」 */
export function formatSegmentList(indexes: number[]): string {
  return `第 ${indexes.map(i => i + 1).join('、')} 句`;
}

export const errorSpotHandler: ReviewModeHandler<ErrorSpotRef, ErrorSpotResponse> = {
  mode: 'error_spot',
  label: '挑錯標註',
  description: '範例答案逐句列出，學生點出有錯的句子，越接近老師標的錯句越高分',
  refSchema: RefSchema,
  responseSchema: ResponseSchema,

  validateSet: (samples) => {
    let anyError = false;
    for (const [i, s] of samples.entries()) {
      const parsed = RefSchema.safeParse(s.refData);
      if (!parsed.success) {
        return `第 ${i + 1} 則範例答案：錯句標記格式錯誤`;
      }
      const count = splitSegments(s.content).length;
      const indexes = parsed.data.errorSegmentIndexes;
      if (indexes.some(idx => idx >= count)) {
        return `第 ${i + 1} 則範例答案：標記的錯句超出範圍（內容目前只有 ${count} 句），請重新標記`;
      }
      if (indexes.length > 0) {
        anyError = true;
      }
    }
    if (!anyError) {
      return '挑錯標註題組至少要有一則範例答案標出錯句';
    }
    return null;
  },

  // 只給切好的句子，絕不帶 errorSegmentIndexes
  toClientData: ({ content }): ErrorSpotClientData => ({ segments: splitSegments(content) }),

  calcSampleAccuracy: ({ sample, sampleScores, pointsForSample }) => {
    if (sampleScores.length === 0) {
      return 0;
    }
    const { avgF1 } = teamStats(sample.content, sample.refData, sampleScores);
    return Math.round(avgF1 * pointsForSample);
  },

  summarize: ({ sample, sampleScores }) => {
    const ref = refIndexes(sample.refData);
    const refText = ref.length === 0 ? '無錯句' : `錯句：${formatSegmentList(ref)}`;
    if (sampleScores.length === 0) {
      return { team: '-', ref: refText };
    }
    const { avgF1, avgSelected } = teamStats(sample.content, sample.refData, sampleScores);
    const selectedText = Number.isInteger(avgSelected) ? String(avgSelected) : avgSelected.toFixed(1);
    return {
      team: `平均選 ${selectedText} 句・命中率 ${Math.round(avgF1 * 100)}%`,
      ref: refText,
    };
  },

  aiInstruction: `本題組是「挑錯標註」題型：學生會看到範例答案被切成一句一句，要點出哪幾句有錯。
1. 每則 samples 除了 content 之外，必須多輸出 "refData": { "errorSegmentIndexes": [...] }，列出這則範例答案中「有錯的句子編號」。
2. 句子編號從 0 開始；切句規則是以全形 。！？； 半形 !?; 與換行作為句子結尾（標點算在該句裡，英文句點「.」不切句），content 第一句是 0、第二句是 1，以此類推。
3. errorSegmentIndexes 必須由小到大排列、不可重複，且每個編號都要小於該則的句數。
4. 每個錯誤都必須是「具體、可單獨指認的一句話」：事實錯誤、計算錯誤或邏輯跳躍，不要把錯誤分散在好幾句、也不要是「不夠完整」這類無法指到單一句子的缺點。
5. 品質較差的範例答案放 2～3 個錯句、中等的放 1～2 個，品質最好的那則可以只有 0～1 個錯句；整組至少要有一則有錯句。
6. 寫完後請逐句數一次編號，確認 errorSegmentIndexes 對得上真正有錯的句子。
範例：content 為「水在 100 度沸騰。冰比水重。所以冰會沉下去！」→ 第 1、2 句有錯 → "refData": { "errorSegmentIndexes": [1, 2] }`,
};
