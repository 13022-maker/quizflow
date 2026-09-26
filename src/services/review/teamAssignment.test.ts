import { describe, expect, it } from 'vitest';

import { assignTeamsRoundRobin } from './teamAssignment';

describe('assignTeamsRoundRobin', () => {
  it('10 人、teamSize=4 時分成 3 組，人數 4/3/3', () => {
    const playerIds = Array.from({ length: 10 }, (_, i) => i + 1); // [1..10]
    const teams = assignTeamsRoundRobin(playerIds, 4);

    expect(teams).toHaveLength(3);
    expect(teams.map(t => t.length)).toEqual([4, 3, 3]);
  });

  it('round-robin 依序發放，第 1 組拿 1,4,7,10', () => {
    const playerIds = Array.from({ length: 10 }, (_, i) => i + 1);
    const teams = assignTeamsRoundRobin(playerIds, 4);

    expect(teams[0]).toEqual([1, 4, 7, 10]);
    expect(teams[1]).toEqual([2, 5, 8]);
    expect(teams[2]).toEqual([3, 6, 9]);
  });

  it('人數剛好整除 teamSize 時每組人數相等', () => {
    const playerIds = Array.from({ length: 8 }, (_, i) => i + 1);
    const teams = assignTeamsRoundRobin(playerIds, 4);

    expect(teams).toHaveLength(2);
    expect(teams.map(t => t.length)).toEqual([4, 4]);
  });

  it('人數少於 teamSize 時只分成 1 組', () => {
    const teams = assignTeamsRoundRobin([1, 2], 4);

    expect(teams).toHaveLength(1);
    expect(teams[0]).toEqual([1, 2]);
  });

  it('沒有玩家時回傳空陣列', () => {
    expect(assignTeamsRoundRobin([], 4)).toEqual([]);
  });
});
