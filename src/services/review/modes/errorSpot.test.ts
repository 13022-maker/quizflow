import { describe, expect, it } from 'vitest';

import { parseGeneratedReviewSet } from '@/lib/ai/reviewSetGeneration';

import { errorSpotHandler, splitSegments } from './errorSpot';
import { calcModeSampleAccuracy } from './index';
import type { ModeSample, ModeScoreRow } from './types';

const ZERO = { correctness: 0, completeness: 0, clarity: 0, creativity: 0 };

// 去掉所有空白，用來驗證切句不會丟字
const squash = (s: string) => s.replace(/\s/g, '');

function expectNoCharLost(content: string) {
  expect(squash(splitSegments(content).join(''))).toBe(squash(content));
}

describe('splitSegments 切句', () => {
  it('中文句號／驚嘆號／問號／分號為界，標點留在句尾', () => {
    const content = '水在一百度沸騰。冰塊會浮在水上！為什麼？因為密度比較小；這是常識';

    expect(splitSegments(content)).toEqual([
      '水在一百度沸騰。',
      '冰塊會浮在水上！',
      '為什麼？',
      '因為密度比較小；',
      '這是常識',
    ]);

    expectNoCharLost(content);
  });

  it('英文 ! ? ; 為界，英文句點不切（避免切到小數 3.14）', () => {
    const content = 'Pi is 3.14! Really? Yes; it is.';

    expect(splitSegments(content)).toEqual(['Pi is 3.14!', 'Really?', 'Yes;', 'it is.']);

    expectNoCharLost(content);
  });

  it('換行也是界線，換行本身不保留', () => {
    const content = '第一行沒有標點\n第二行也沒有\r\n第三行。';

    expect(splitSegments(content)).toEqual(['第一行沒有標點', '第二行也沒有', '第三行。']);

    expectNoCharLost(content);
  });

  it('連續標點（！？、……、。。。）歸在同一句', () => {
    const content = '真的嗎！？我不信……。。。好吧？！結束';

    expect(splitSegments(content)).toEqual(['真的嗎！？', '我不信……。。。', '好吧？！', '結束']);

    expectNoCharLost(content);
  });

  it('句尾的右引號／右括號跟著前一句', () => {
    const content = '老師說：「答案是 5。」我們照做（真的！）然後交卷';

    expect(splitSegments(content)).toEqual(['老師說：「答案是 5。」', '我們照做（真的！）', '然後交卷']);

    expectNoCharLost(content);
  });

  it('結尾沒有標點時最後一段仍是一句；整段沒標點就是一句', () => {
    expect(splitSegments('第一句。第二句沒標點')).toEqual(['第一句。', '第二句沒標點']);
    expect(splitSegments('  整段完全沒有標點  ')).toEqual(['整段完全沒有標點']);
  });

  it('每段 trim，空段丟掉（空行、標點後的空白）', () => {
    const content = '  甲。  \n\n   乙！ \n  ';

    expect(splitSegments(content)).toEqual(['甲。', '乙！']);

    expectNoCharLost(content);
  });

  it('全空白或空字串 → 空陣列', () => {
    expect(splitSegments('')).toEqual([]);
    expect(splitSegments('   \n\t  \n')).toEqual([]);
  });

  it('只有標點也算一句（不丟字）', () => {
    expect(splitSegments('！？')).toEqual(['！？']);
  });
});

// 4 句：0「地球繞太陽轉。」1「月亮會自己發光。」2「一年有 365 天。」3「2+2=5！」
const CONTENT = '地球繞太陽轉。月亮會自己發光。一年有 365 天。2+2=5！';

function sampleWith(errorSegmentIndexes: number[]): ModeSample {
  return { id: 1, content: CONTENT, orderIndex: 0, ref: ZERO, refData: { errorSegmentIndexes } };
}

function row(playerId: number, selectedSegmentIndexes: number[]): ModeScoreRow {
  return { playerId, sampleId: 1, rubric: ZERO, responseData: { selectedSegmentIndexes } };
}

describe('errorSpot refSchema / responseSchema', () => {
  it('合法：不重複、遞增、非負整數（含空陣列）', () => {
    expect(errorSpotHandler.refSchema!.safeParse({ errorSegmentIndexes: [1, 3] }).success).toBe(true);
    expect(errorSpotHandler.refSchema!.safeParse({ errorSegmentIndexes: [] }).success).toBe(true);
    expect(errorSpotHandler.responseSchema!.safeParse({ selectedSegmentIndexes: [0, 2] }).success).toBe(true);
  });

  it('不合法：重複、未排序、負數、小數、缺欄位', () => {
    const bad = [[1, 1], [3, 1], [-1], [1.5]];
    for (const idx of bad) {
      expect(errorSpotHandler.refSchema!.safeParse({ errorSegmentIndexes: idx }).success).toBe(false);
      expect(errorSpotHandler.responseSchema!.safeParse({ selectedSegmentIndexes: idx }).success).toBe(false);
    }

    expect(errorSpotHandler.refSchema!.safeParse(undefined).success).toBe(false);
    expect(errorSpotHandler.responseSchema!.safeParse({}).success).toBe(false);
  });

  it('學生作答最多 50 個索引', () => {
    const fifty = Array.from({ length: 50 }, (_, i) => i);
    const fiftyOne = Array.from({ length: 51 }, (_, i) => i);

    expect(errorSpotHandler.responseSchema!.safeParse({ selectedSegmentIndexes: fifty }).success).toBe(true);
    expect(errorSpotHandler.responseSchema!.safeParse({ selectedSegmentIndexes: fiftyOne }).success).toBe(false);
  });
});

describe('errorSpot validateSet', () => {
  it('索引都在範圍內、且至少一則有錯句 → null', () => {
    expect(errorSpotHandler.validateSet([
      { content: CONTENT, refData: { errorSegmentIndexes: [1, 3] } },
      { content: '全對。', refData: { errorSegmentIndexes: [] } },
    ])).toBeNull();
  });

  it('第 2 則索引越界（只有 1 句卻標第 2 句）→ 訊息指出第 2 則', () => {
    const err = errorSpotHandler.validateSet([
      { content: CONTENT, refData: { errorSegmentIndexes: [1] } },
      { content: '只有一句。', refData: { errorSegmentIndexes: [1] } },
    ]);

    expect(err).toContain('第 2 則');
  });

  it('整組都沒有標錯句 → 擋下', () => {
    const err = errorSpotHandler.validateSet([
      { content: CONTENT, refData: { errorSegmentIndexes: [] } },
      { content: '全對。', refData: { errorSegmentIndexes: [] } },
    ]);

    expect(err).toContain('至少');
  });
});

describe('errorSpot toClientData', () => {
  it('只給切好的句子，不含標準答案', () => {
    const data = errorSpotHandler.toClientData({ content: CONTENT, refData: { errorSegmentIndexes: [1, 3] } });

    expect(data).toEqual({ segments: ['地球繞太陽轉。', '月亮會自己發光。', '一年有 365 天。', '2+2=5！'] });
    expect(JSON.stringify(data)).not.toContain('errorSegmentIndexes');
  });
});

describe('errorSpot 計分（F1 平均 × 配分）', () => {
  it('全中：標準 {1,3}、學生 {1,3} → F1=1 → 300', () => {
    expect(calcModeSampleAccuracy('error_spot', {
      sample: sampleWith([1, 3]),
      sampleScores: [row(1, [1, 3])],
      sampleCount: 3,
      pointsForSample: 300,
    })).toBe(300);
  });

  it('標準與學生都是空集合 → 100%', () => {
    expect(calcModeSampleAccuracy('error_spot', {
      sample: sampleWith([]),
      sampleScores: [row(1, [])],
      sampleCount: 3,
      pointsForSample: 300,
    })).toBe(300);
  });

  it('標準空、學生有選 → 0；標準有、學生沒選 → 0', () => {
    expect(calcModeSampleAccuracy('error_spot', {
      sample: sampleWith([]),
      sampleScores: [row(1, [2])],
      sampleCount: 3,
      pointsForSample: 300,
    })).toBe(0);
    expect(calcModeSampleAccuracy('error_spot', {
      sample: sampleWith([1]),
      sampleScores: [row(1, [])],
      sampleCount: 3,
      pointsForSample: 300,
    })).toBe(0);
  });

  it('兩人平均：標準 {1,3}；甲選 {1,2} → P=1/2 R=1/2 F1=0.5；乙選 {1,3} → F1=1；平均 0.75 × 300 = 225', () => {
    expect(calcModeSampleAccuracy('error_spot', {
      sample: sampleWith([1, 3]),
      sampleScores: [row(1, [1, 2]), row(2, [1, 3])],
      sampleCount: 3,
      pointsForSample: 300,
    })).toBe(225);
  });

  it('標準 {1,2,3}、學生 {1} → P=1 R=1/3 F1=2·(1/3)/(4/3)=0.5 → 配分 333 × 0.5 = 166.5 → 四捨五入 167', () => {
    expect(calcModeSampleAccuracy('error_spot', {
      sample: sampleWith([1, 2, 3]),
      sampleScores: [row(1, [1])],
      sampleCount: 3,
      pointsForSample: 333,
    })).toBe(167);
  });

  it('學生送了超出句數的索引（這則只有 4 句）→ 忽略越界索引：選 {1,3,9,40} 視為 {1,3} → 滿分', () => {
    expect(calcModeSampleAccuracy('error_spot', {
      sample: sampleWith([1, 3]),
      sampleScores: [row(1, [1, 3, 9, 40])],
      sampleCount: 3,
      pointsForSample: 300,
    })).toBe(300);
  });

  it('作答格式壞掉的列當作沒選任何句子（不 crash）', () => {
    const broken: ModeScoreRow = { playerId: 9, sampleId: 1, rubric: ZERO, responseData: null };

    // 標準 {1}，壞列視為 {} → F1=0；另一人全中 F1=1；平均 0.5 × 300 = 150
    expect(calcModeSampleAccuracy('error_spot', {
      sample: sampleWith([1]),
      sampleScores: [broken, row(1, [1])],
      sampleCount: 3,
      pointsForSample: 300,
    })).toBe(150);
  });
});

describe('errorSpot summarize', () => {
  it('小組平均選句數與命中率；標準以 1-based 顯示', () => {
    // 標準 {1,3}；甲 {1,2}（2 句，F1 0.5）、乙 {1,3}（2 句，F1 1）、丙 {1}（1 句，P=1 R=1/2 F1=2/3）
    // 平均選 (2+2+1)/3 = 1.666… → 1.7 句；命中率 (0.5+1+0.6667)/3 = 0.7222 → 72%
    expect(errorSpotHandler.summarize({
      sample: sampleWith([1, 3]),
      sampleScores: [row(1, [1, 2]), row(2, [1, 3]), row(3, [1])],
    })).toEqual({ team: '平均選 1.7 句・命中率 72%', ref: '錯句：第 2、4 句' });
  });

  it('整數平均不顯示小數；標準無錯句顯示「無錯句」', () => {
    // 標準 {}；甲 {}（F1 1）、乙 {0,2}（F1 0）→ 平均選 (0+2)/2 = 1 句；命中率 50%
    expect(errorSpotHandler.summarize({
      sample: sampleWith([]),
      sampleScores: [row(1, []), row(2, [0, 2])],
    })).toEqual({ team: '平均選 1 句・命中率 50%', ref: '無錯句' });
  });

  it('沒人作答 → team 顯示 -', () => {
    expect(errorSpotHandler.summarize({ sample: sampleWith([1]), sampleScores: [] }).team).toBe('-');
  });
});

describe('errorSpot aiInstruction 與 AI 生成解析', () => {
  it('aiInstruction 說明 refData 欄位、0 起算與切句規則', () => {
    expect(errorSpotHandler.aiInstruction).toContain('errorSegmentIndexes');
    expect(errorSpotHandler.aiInstruction).toContain('0 開始');
    expect(errorSpotHandler.aiInstruction).toContain('。！？；');
  });

  const aiJson = (third: number[]) => JSON.stringify({
    topicPrompt: '小組要找出範例答案裡的錯誤句子，並共創正確版本。',
    samples: [
      // 4 句，錯在第 1、3 句（0-based）
      { content: '水在攝氏 100 度沸騰。冰的密度比水大。所以冰會浮在水面。因此湖面先結冰是因為冰比較重！', refData: { errorSegmentIndexes: [1, 3] } },
      // 3 句，錯在第 2 句
      { content: '光合作用需要陽光。植物會吸收二氧化碳。最後產生的是氮氣？', refData: { errorSegmentIndexes: [2] } },
      // 2 句
      { content: '三角形內角和是 180 度；正方形四個角都是直角。', refData: { errorSegmentIndexes: third } },
    ],
  });

  it('假 AI 回應（前後夾雜說明文字）→ 解析成功且保留 refData', () => {
    const raw = `好的，以下是題組：\n${aiJson([])}\n希望有幫助`;
    const result = parseGeneratedReviewSet(raw, 'error_spot');

    expect(result).not.toBeNull();
    expect(result!.samples.map(s => s.refData)).toEqual([
      { errorSegmentIndexes: [1, 3] },
      { errorSegmentIndexes: [2] },
      { errorSegmentIndexes: [] },
    ]);
  });

  it('AI 標的索引越界（第 3 則只有 2 句卻標第 5 句）→ null', () => {
    expect(parseGeneratedReviewSet(aiJson([4]), 'error_spot')).toBeNull();
  });

  it('AI 漏了 refData → null', () => {
    const raw = JSON.stringify({
      topicPrompt: 'x',
      samples: [{ content: '甲。' }, { content: '乙。' }, { content: '丙。' }],
    });

    expect(parseGeneratedReviewSet(raw, 'error_spot')).toBeNull();
  });
});

describe('errorSpot refSchema 錯誤訊息', () => {
  it('refData 尚未設定（undefined）時回繁中提示，不是 zod 預設英文', () => {
    const r = errorSpotHandler.refSchema!.safeParse(undefined);

    expect(r.success).toBe(false);
    expect(r.success ? '' : r.error.errors[0]?.message).toBe('請點選這則答案中有錯的句子');
  });
});
