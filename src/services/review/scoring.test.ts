import { describe, expect, it } from 'vitest';

import {
  calcAccuracyScore,
  calcSpeedBonus,
  calcTeamTotalScore,
  calcVoteBonus,
  distributeAccuracyPoints,
} from './scoring';

const PERFECT: { correctness: number; completeness: number; clarity: number; creativity: number } = {
  correctness: 5,
  completeness: 5,
  clarity: 5,
  creativity: 5,
};

describe('distributeAccuracyPoints', () => {
  it('3 則範例答案，1000 分平分後餘數給前面：334/333/333', () => {
    expect(distributeAccuracyPoints(3)).toEqual([334, 333, 333]);
  });

  it('4 則範例答案整除：250/250/250/250', () => {
    expect(distributeAccuracyPoints(4)).toEqual([250, 250, 250, 250]);
  });

  it('0 則回傳空陣列', () => {
    expect(distributeAccuracyPoints(0)).toEqual([]);
  });
});

describe('calcAccuracyScore', () => {
  it('team 平均分跟標準分完全一致時拿滿分', () => {
    expect(calcAccuracyScore(PERFECT, PERFECT, 250)).toBe(250);
  });

  it('每個維度都差 1 分時，每維度扣 20% → 拿 80%', () => {
    const teamAvg = { correctness: 4, completeness: 4, clarity: 4, creativity: 4 };

    expect(calcAccuracyScore(teamAvg, PERFECT, 250)).toBe(200);
  });

  it('差距達 5 分以上時該維度歸零，四維度都差 5 分 → 整體 0 分', () => {
    const teamAvg = { correctness: 0, completeness: 0, clarity: 0, creativity: 0 };

    expect(calcAccuracyScore(teamAvg, PERFECT, 250)).toBe(0);
  });

  it('只有部分維度有落差時按比例計算', () => {
    // correctness 完全命中(100%)，其餘三維度差 1 分(80%)：(100+80+80+80)/4=85% * 250 = 212.5 → 四捨五入 213
    const teamAvg = { correctness: 5, completeness: 4, clarity: 4, creativity: 4 };

    expect(calcAccuracyScore(teamAvg, PERFECT, 250)).toBe(213);
  });
});

describe('calcSpeedBonus', () => {
  it('一開始就完成（elapsedSec=0）拿滿額 1000', () => {
    expect(calcSpeedBonus(0, 600)).toBe(1000);
  });

  it('用掉一半時間完成，拿 750（1000*(1-0.5*0.5)）', () => {
    expect(calcSpeedBonus(300, 600)).toBe(750);
  });

  it('接近時限完成時分數接近 500 但不會低於它（500 是數學上界，非可觸發的保底）', () => {
    expect(calcSpeedBonus(599, 600)).toBe(501);
  });

  it('超過或等於總時長（沒在時限內完成）拿 0', () => {
    expect(calcSpeedBonus(600, 600)).toBe(0);
    expect(calcSpeedBonus(700, 600)).toBe(0);
  });
});

describe('calcVoteBonus', () => {
  it('0 票拿 0 分', () => {
    expect(calcVoteBonus(0)).toBe(0);
  });

  it('每票 100 分，線性累加', () => {
    expect(calcVoteBonus(3)).toBe(300);
  });
});

describe('calcTeamTotalScore', () => {
  it('加總所有範例答案的準確度分 + 速度加成 + 投票加成', () => {
    const total = calcTeamTotalScore({
      accuracyScores: [250, 200, 180],
      speedBonus: 750,
      voteBonus: 200,
    });

    expect(total).toBe(250 + 200 + 180 + 750 + 200);
  });

  it('全部為 0 時總分為 0', () => {
    expect(calcTeamTotalScore({ accuracyScores: [], speedBonus: 0, voteBonus: 0 })).toBe(0);
  });
});
