// ranking 題型（排序比較）：學生把題組裡的範例答案依品質由好到差排名次（第 1 名最好），
// 每則範例答案各自跟老師標準名次比對，名次差越小分數越高。
// 介面上是「一則範例答案一個面板」，所以作答是每則各選一個名次。
import { z } from 'zod';

import type { ModeScoreRow, ReviewModeHandler } from './types';

// 範例答案上限是 10 則（ReviewSetInputSchema），所以作答名次也限 1–10
const MAX_RANK = 10;

export const RankingRefSchema = z.object({
  rank: z.number({ required_error: '請設定標準名次', invalid_type_error: '請設定標準名次' })
    .int('標準名次必須是整數')
    .positive('標準名次必須是正整數'),
}, { required_error: '請設定標準名次', invalid_type_error: '請設定標準名次' });
export type RankingRef = z.infer<typeof RankingRefSchema>;

export const RankingResponseSchema = z.object({
  rank: z.number({ required_error: '請選擇名次', invalid_type_error: '請選擇名次' })
    .int('名次必須是整數')
    .min(1, '名次至少是第 1 名')
    .max(MAX_RANK, `名次最多是第 ${MAX_RANK} 名`),
}, { required_error: '請選擇名次', invalid_type_error: '請選擇名次' });
export type RankingResponse = z.infer<typeof RankingResponseSchema>;

/** 從任意資料安全取出名次；格式不合回 null（server 不信任 DB 以外來源，也防舊資料） */
function readRank(data: unknown): number | null {
  const parsed = RankingRefSchema.safeParse(data);
  return parsed.success ? parsed.data.rank : null;
}

/**
 * 單人百分比：1 − |r − R| / (N − 1)；N = 1 時排第 1 名即 100%。
 * r 超出 1..N 或格式不合一律 0%。
 */
export function rankPercent(studentRank: number | null, refRank: number, sampleCount: number): number {
  if (studentRank === null || studentRank < 1 || studentRank > sampleCount) {
    return 0;
  }
  if (sampleCount <= 1) {
    return studentRank === refRank ? 1 : 0;
  }
  return Math.max(0, 1 - Math.abs(studentRank - refRank) / (sampleCount - 1));
}

function averageRank(rows: ModeScoreRow[]): number | null {
  const ranks = rows.map(r => readRank(r.responseData)).filter((r): r is number => r !== null);
  if (ranks.length === 0) {
    return null;
  }
  return ranks.reduce((a, b) => a + b, 0) / ranks.length;
}

const fmtRank = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export const rankingHandler: ReviewModeHandler<RankingRef, RankingResponse> = {
  mode: 'ranking',
  label: '排序比較',
  description: '把範例答案依品質由好到差排名次（第 1 名最好），名次越接近老師標準越高分',
  refSchema: RankingRefSchema,
  responseSchema: RankingResponseSchema,

  validateSet: (samples) => {
    const n = samples.length;
    if (n < 2) {
      return '排序比較題型至少要有 2 則範例答案';
    }
    const counts = new Map<number, number>();
    for (const [i, s] of samples.entries()) {
      const rank = readRank(s.refData);
      if (rank === null) {
        return `第 ${i + 1} 則範例答案：請設定標準名次`;
      }
      counts.set(rank, (counts.get(rank) ?? 0) + 1);
    }
    const errors: string[] = [];
    for (const [rank, count] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
      if (rank > n) {
        errors.push(`名次 ${rank} 超出範圍（共 ${n} 則，只能排 1–${n}）`);
      } else if (count > 1) {
        errors.push(`名次 ${rank} 重複`);
      }
    }
    for (let rank = 1; rank <= n; rank++) {
      if (!counts.has(rank)) {
        errors.push(`缺少名次 ${rank}`);
      }
    }
    return errors.length > 0 ? `標準名次必須剛好是 1–${n} 各一次：${errors.join('、')}` : null;
  },

  // 名次就是標準答案，絕不能給學生；學生需要的總則數由 ReviewPanelProps.sampleCount 提供
  toClientData: () => null,

  calcSampleAccuracy: ({ sample, sampleScores, sampleCount, pointsForSample }) => {
    const refRank = readRank(sample.refData);
    if (refRank === null || sampleScores.length === 0) {
      return 0;
    }
    const total = sampleScores.reduce(
      (acc, row) => acc + rankPercent(readRank(row.responseData), refRank, sampleCount),
      0,
    );
    return Math.round((total / sampleScores.length) * pointsForSample);
  },

  summarize: ({ sample, sampleScores }) => {
    const avg = averageRank(sampleScores);
    const refRank = readRank(sample.refData);
    return {
      team: avg === null ? '-' : `平均第 ${fmtRank(avg)} 名`,
      ref: refRank === null ? '-' : `第 ${refRank} 名`,
    };
  },

  aiInstruction: `本題組使用「排序比較」題型：學生要把 3 則範例答案依品質由好到差排名次（第 1 名＝品質最好）。
請在每則 samples 的 JSON 物件多加一個欄位 "refData": { "rank": n }，代表這則範例答案的標準名次：
- 3 則的 rank 必須是 1、2、3 各出現一次，不可重複
- 名次必須跟前面要求刻意拉開的品質差距一致：明顯薄弱的第 1 則 → "rank": 3；中等的第 2 則 → "rank": 2；完整且有創意的第 3 則 → "rank": 1
- 品質差距要清楚到學生能說出排序理由，但不要差到一眼就能排完，相鄰名次之間要有可以討論的地方
範例：{ "content": "…", "ref": { … }, "refData": { "rank": 3 } }`,
};
