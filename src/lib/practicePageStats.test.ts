import { describe, expect, it } from 'vitest';

import { buildQuestionStats, leadsToCsv } from './practicePageStats';

describe('buildQuestionStats', () => {
  it('依錯誤率由高到低排序，並標出最多人選的錯誤選項', () => {
    const rows = [
      // 第 1 題（index 0）：正解 1，4 人作答 3 對 1 錯 → 錯誤率 25%
      { questionIndex: 0, questionId: 11, chosenOption: 1, isCorrect: true, count: 3 },
      { questionIndex: 0, questionId: 11, chosenOption: 0, isCorrect: false, count: 1 },
      // 第 2 題（index 1）：正解 2，5 人作答 1 對 4 錯，錯誤選項 0 有 3 人、3 有 1 人 → 錯誤率 80%
      { questionIndex: 1, questionId: 12, chosenOption: 2, isCorrect: true, count: 1 },
      { questionIndex: 1, questionId: 12, chosenOption: 0, isCorrect: false, count: 3 },
      { questionIndex: 1, questionId: 12, chosenOption: 3, isCorrect: false, count: 1 },
    ];

    const stats = buildQuestionStats(rows);

    expect(stats.map(s => s.questionIndex)).toEqual([1, 0]);
    expect(stats[0]).toEqual({
      questionIndex: 1,
      questionId: 12,
      attempts: 5,
      wrong: 4,
      errorRate: 0.8,
      distribution: [
        { option: 0, count: 3, isCorrect: false },
        { option: 2, count: 1, isCorrect: true },
        { option: 3, count: 1, isCorrect: false },
      ],
      topWrongOption: 0,
    });
    expect(stats[1]!.errorRate).toBe(0.25);
    expect(stats[1]!.topWrongOption).toBe(0);
  });

  it('全部答對的題目 topWrongOption 是 null', () => {
    const stats = buildQuestionStats([{ questionIndex: 0, questionId: null, chosenOption: 2, isCorrect: true, count: 7 }]);

    expect(stats[0]!.errorRate).toBe(0);
    expect(stats[0]!.topWrongOption).toBe(null);
  });

  it('錯誤率相同時題號小的排前面', () => {
    const stats = buildQuestionStats([
      { questionIndex: 5, questionId: null, chosenOption: 0, isCorrect: false, count: 1 },
      { questionIndex: 2, questionId: null, chosenOption: 0, isCorrect: false, count: 1 },
    ]);

    expect(stats.map(s => s.questionIndex)).toEqual([2, 5]);
  });
});

describe('leadsToCsv', () => {
  it('輸出含 BOM 的 CSV，email 內的逗號/引號要正確跳脫，並擋掉試算表公式注入', () => {
    const csv = leadsToCsv([
      { email: 'a@b.com', consentAt: new Date('2026-11-01T02:03:04.000Z'), sessionId: 's1', shareId: 24 },
      { email: '=cmd@x.com', consentAt: new Date('2026-11-02T00:00:00.000Z'), sessionId: 's"2', shareId: 24 },
    ]);

    expect(csv).toBe(
      '\uFEFFemail,consent_at,session_id,share_id\r\n'
      + 'a@b.com,2026-11-01T02:03:04.000Z,s1,24\r\n'
      + '\'=cmd@x.com,2026-11-02T00:00:00.000Z,"s""2",24\r\n',
    );
  });
});
