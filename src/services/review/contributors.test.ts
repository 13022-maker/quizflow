import { describe, expect, it } from 'vitest';

import { summarizeContributors } from './contributors';

describe('summarizeContributors', () => {
  it('依編輯次數由多到少排序', () => {
    const players = [
      { id: 1, nickname: '小明' },
      { id: 2, nickname: '小華' },
    ];
    const editRows = [
      { playerId: 1 },
      { playerId: 2 },
      { playerId: 1 },
      { playerId: 1 },
    ];

    const result = summarizeContributors(editRows, players);

    expect(result).toEqual([
      { playerId: 1, nickname: '小明', editCount: 3 },
      { playerId: 2, nickname: '小華', editCount: 1 },
    ]);
  });

  it('沒有動手過的組員不會出現在結果裡', () => {
    const players = [
      { id: 1, nickname: '小明' },
      { id: 2, nickname: '小華' },
    ];
    const editRows = [{ playerId: 1 }];

    const result = summarizeContributors(editRows, players);

    expect(result).toEqual([{ playerId: 1, nickname: '小明', editCount: 1 }]);
  });

  it('沒有任何編輯記錄時回傳空陣列', () => {
    const players = [{ id: 1, nickname: '小明' }];

    expect(summarizeContributors([], players)).toEqual([]);
  });
});
