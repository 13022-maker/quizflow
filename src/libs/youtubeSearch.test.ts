import { describe, expect, it } from 'vitest';

import { coarseRank, parseIso8601Duration, refineRank, type SearchCandidate } from './youtubeSearch';

describe('parseIso8601Duration', () => {
  it('分秒格式：PT12M34S → 754 秒', () => {
    expect(parseIso8601Duration('PT12M34S')).toBe(754);
  });

  it('含小時：PT1H2M3S → 3723 秒', () => {
    expect(parseIso8601Duration('PT1H2M3S')).toBe(3723);
  });

  it('只有秒：PT45S → 45 秒', () => {
    expect(parseIso8601Duration('PT45S')).toBe(45);
  });

  it('只有分鐘：PT10M → 600 秒', () => {
    expect(parseIso8601Duration('PT10M')).toBe(600);
  });
});

function makeCandidate(overrides: Partial<SearchCandidate> = {}): SearchCandidate {
  return {
    videoId: 'vid-default',
    title: '預設標題',
    channelTitle: '預設頻道',
    thumbnailUrl: 'https://example.com/thumb.jpg',
    durationSec: 600, // 10 分鐘，落在甜蜜區間
    viewCount: 1000,
    categoryId: '22', // 非教育類別
    ...overrides,
  };
}

describe('coarseRank', () => {
  it('時長落在 5~20 分鐘內的候選排在明顯偏離的候選前面（其餘條件相同）', () => {
    const short = makeCandidate({ videoId: 'short', durationSec: 30 }); // 30 秒，明顯偏離
    const sweet = makeCandidate({ videoId: 'sweet', durationSec: 600 }); // 10 分鐘，甜蜜區間
    const ranked = coarseRank([short, sweet]);

    expect(ranked[0]!.videoId).toBe('sweet');
  });

  it('教育分類的候選在時長相同時排更前面（即使相關度稍低）', () => {
    // 只用 2 支候選會讓「相關度排第 2 名的扣分」剛好跟「教育分類加分」打平（都是 0.2），
    // 造成同分——排序結果在同分時不保證誰在前，測試會不穩定。用 3 支候選把 edu 放在
    // 中間（idx 1），相關度扣分縮小成 0.4*(1/3)≈0.133，小於教育分類加分 0.2，edu 才會
    // 明確贏過 first，不會跟任何候選同分。
    const first = makeCandidate({ videoId: 'first', categoryId: '22' });
    const education = makeCandidate({ videoId: 'edu', categoryId: '27' });
    const third = makeCandidate({ videoId: 'third', categoryId: '22' });
    const ranked = coarseRank([first, education, third]);

    expect(ranked[0]!.videoId).toBe('edu');
  });

  it('其餘條件相同時保留原始相關度順序（陣列順序）', () => {
    const first = makeCandidate({ videoId: 'first' });
    const second = makeCandidate({ videoId: 'second' });
    const ranked = coarseRank([first, second]);

    expect(ranked.map(c => c.videoId)).toEqual(['first', 'second']);
  });

  it('候選數超過 12 名時只回傳前 12 名', () => {
    const candidates = Array.from({ length: 20 }, (_, i) => makeCandidate({ videoId: `v${i}` }));
    const ranked = coarseRank(candidates);

    expect(ranked).toHaveLength(12);
  });
});

describe('refineRank', () => {
  it('手動字幕的候選排到同時長的自動字幕候選前面', () => {
    const auto = makeCandidate({ videoId: 'auto' });
    const manual = makeCandidate({ videoId: 'manual' });
    const captionKinds = new Map<string, 'manual' | 'auto'>([
      ['auto', 'auto'],
      ['manual', 'manual'],
    ]);
    // 陣列順序刻意讓 auto 在前，驗證手動字幕加分足以逆轉排名
    const ranked = refineRank([auto, manual], captionKinds);

    expect(ranked[0]!.videoId).toBe('manual');
    expect(ranked[0]!.captionKind).toBe('manual');
  });

  it('captionKinds 沒有某支影片的紀錄時視為 auto（不拋錯）', () => {
    const unknown = makeCandidate({ videoId: 'unknown' });
    const ranked = refineRank([unknown], new Map());

    expect(ranked[0]!.captionKind).toBe('auto');
  });

  it('最多回傳 8 筆', () => {
    const candidates = Array.from({ length: 12 }, (_, i) => makeCandidate({ videoId: `v${i}` }));
    const ranked = refineRank(candidates, new Map());

    expect(ranked).toHaveLength(8);
  });

  it('回傳的物件不含內部用的 score 欄位', () => {
    const candidate = makeCandidate({ videoId: 'v0' });
    const ranked = refineRank([candidate], new Map());

    expect(ranked[0]).not.toHaveProperty('score');
  });
});
