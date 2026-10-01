import { describe, expect, it } from 'vitest';

import { summarizeContributors } from './contributors';

describe('summarizeContributors', () => {
  it('依字數由多到少排序', () => {
    const players = [
      { id: 1, nickname: '小明' },
      { id: 2, nickname: '小華' },
    ];
    const draftRows = [
      { playerId: 1, charCount: 30 },
      { playerId: 2, charCount: 80 },
    ];

    const result = summarizeContributors(draftRows, players);

    expect(result).toEqual([
      { playerId: 2, nickname: '小華', charCount: 80 },
      { playerId: 1, nickname: '小明', charCount: 30 },
    ]);
  });

  it('草稿是空字串（字數 0）的組員仍會出現在結果裡', () => {
    const players = [{ id: 1, nickname: '小明' }];
    const draftRows = [{ playerId: 1, charCount: 0 }];

    expect(summarizeContributors(draftRows, players)).toEqual([
      { playerId: 1, nickname: '小明', charCount: 0 },
    ]);
  });

  it('完全沒動過草稿欄的組員不會出現在結果裡（沒有 draft row）', () => {
    const players = [
      { id: 1, nickname: '小明' },
      { id: 2, nickname: '小華' },
    ];
    const draftRows = [{ playerId: 1, charCount: 10 }];

    expect(summarizeContributors(draftRows, players)).toEqual([
      { playerId: 1, nickname: '小明', charCount: 10 },
    ]);
  });

  it('沒有任何草稿記錄時回傳空陣列', () => {
    expect(summarizeContributors([], [{ id: 1, nickname: '小明' }])).toEqual([]);
  });
});
