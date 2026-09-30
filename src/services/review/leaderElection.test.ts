import { describe, expect, it } from 'vitest';

import { pickLeader } from './leaderElection';

describe('pickLeader', () => {
  it('得票最高者當選', () => {
    const members = [
      { id: 1, joinedAt: new Date('2026-01-01T00:00:00Z') },
      { id: 2, joinedAt: new Date('2026-01-01T00:00:01Z') },
      { id: 3, joinedAt: new Date('2026-01-01T00:00:02Z') },
    ];
    const votes = [
      { voterPlayerId: 1, votedForPlayerId: 2 },
      { voterPlayerId: 2, votedForPlayerId: 2 },
      { voterPlayerId: 3, votedForPlayerId: 3 },
    ];

    expect(pickLeader(votes, members)).toBe(2);
  });

  it('平票時取最早加入的成員', () => {
    const members = [
      { id: 1, joinedAt: new Date('2026-01-01T00:00:02Z') }, // 最晚加入
      { id: 2, joinedAt: new Date('2026-01-01T00:00:00Z') }, // 最早加入
      { id: 3, joinedAt: new Date('2026-01-01T00:00:01Z') },
    ];
    const votes = [
      { voterPlayerId: 1, votedForPlayerId: 1 },
      { voterPlayerId: 2, votedForPlayerId: 2 },
      { voterPlayerId: 3, votedForPlayerId: 3 },
    ]; // 1、2、3 各得 1 票，平手

    expect(pickLeader(votes, members)).toBe(2); // id=2 最早加入
  });

  it('沒有任何人投票時，預設最早加入的成員當隊長', () => {
    const members = [
      { id: 5, joinedAt: new Date('2026-01-01T00:00:01Z') },
      { id: 6, joinedAt: new Date('2026-01-01T00:00:00Z') },
    ];

    expect(pickLeader([], members)).toBe(6);
  });

  it('只有 1 位成員時，該成員永遠是隊長', () => {
    const members = [{ id: 9, joinedAt: new Date('2026-01-01T00:00:00Z') }];

    expect(pickLeader([], members)).toBe(9);
    expect(pickLeader([{ voterPlayerId: 9, votedForPlayerId: 9 }], members)).toBe(9);
  });

  it('沒有任何成員時回傳 null', () => {
    expect(pickLeader([], [])).toBeNull();
  });
});
