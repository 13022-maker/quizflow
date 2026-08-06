import { describe, expect, it } from 'vitest';

import {
  applyRandomClozeBlanks,
  countClozeBlanks,
  extractClozeAnswers,
  findClozeCandidates,
  gradeClozeAnswers,
  parseClozeBody,
  stripClozeMarkers,
} from './cloze';

describe('parseClozeBody', () => {
  it('沒有標記時回傳單一 text 段落', () => {
    expect(parseClozeBody('光合作用是一個過程。')).toEqual([
      { kind: 'text', text: '光合作用是一個過程。' },
    ]);
  });

  it('解析單一標記，前後都有文字', () => {
    expect(parseClozeBody('光合作用需要[[陽光]]才能進行。')).toEqual([
      { kind: 'text', text: '光合作用需要' },
      { kind: 'blank', index: 0, answer: '陽光' },
      { kind: 'text', text: '才能進行。' },
    ]);
  });

  it('解析多個標記，index 依出現順序遞增', () => {
    expect(parseClozeBody('需要[[陽光]]、水和[[二氧化碳]]。')).toEqual([
      { kind: 'text', text: '需要' },
      { kind: 'blank', index: 0, answer: '陽光' },
      { kind: 'text', text: '、水和' },
      { kind: 'blank', index: 1, answer: '二氧化碳' },
      { kind: 'text', text: '。' },
    ]);
  });

  it('標記在開頭或結尾時不多出空的 text 段落', () => {
    expect(parseClozeBody('[[陽光]]很重要')).toEqual([
      { kind: 'blank', index: 0, answer: '陽光' },
      { kind: 'text', text: '很重要' },
    ]);
    expect(parseClozeBody('很重要的是[[陽光]]')).toEqual([
      { kind: 'text', text: '很重要的是' },
      { kind: 'blank', index: 0, answer: '陽光' },
    ]);
  });

  it('標記內容前後空白會被 trim', () => {
    expect(parseClozeBody('需要[[ 陽光 ]]。')).toEqual([
      { kind: 'text', text: '需要' },
      { kind: 'blank', index: 0, answer: '陽光' },
      { kind: 'text', text: '。' },
    ]);
  });
});

describe('extractClozeAnswers / countClozeBlanks', () => {
  it('依出現順序回傳答案陣列', () => {
    expect(extractClozeAnswers('需要[[陽光]]和[[水]]。')).toEqual(['陽光', '水']);
  });

  it('沒有標記時回傳空陣列', () => {
    expect(extractClozeAnswers('沒有標記的文字')).toEqual([]);
  });

  it('countClozeBlanks 回傳標記數量', () => {
    expect(countClozeBlanks('需要[[陽光]]、水和[[二氧化碳]]。')).toBe(2);
    expect(countClozeBlanks('沒有標記')).toBe(0);
  });
});

describe('stripClozeMarkers', () => {
  it('把標記換成預設佔位符，不洩漏答案', () => {
    expect(stripClozeMarkers('需要[[陽光]]和[[水]]。')).toBe('需要＿＿＿＿和＿＿＿＿。');
  });

  it('可自訂佔位符', () => {
    expect(stripClozeMarkers('需要[[陽光]]。', '___')).toBe('需要___。');
  });

  it('沒有標記時原樣回傳', () => {
    expect(stripClozeMarkers('普通文字')).toBe('普通文字');
  });
});

describe('gradeClozeAnswers', () => {
  it('全部答對 → isCorrect true，awardedRatio 1', () => {
    const result = gradeClozeAnswers(['陽光', '水'], ['陽光', '水']);
    expect(result).toEqual({
      perBlank: [true, true],
      correctCount: 2,
      totalBlanks: 2,
      isCorrect: true,
      awardedRatio: 1,
    });
  });

  it('部分答對 → isCorrect false，awardedRatio 按比例', () => {
    const result = gradeClozeAnswers(['陽光', '水', '二氧化碳'], ['陽光', '水', '土']);
    expect(result.correctCount).toBe(2);
    expect(result.totalBlanks).toBe(3);
    expect(result.isCorrect).toBe(false);
    expect(result.awardedRatio).toBeCloseTo(2 / 3);
  });

  it('比對忽略前後空白與英文大小寫', () => {
    const result = gradeClozeAnswers(['Sunlight'], [' sunlight ']);
    expect(result.perBlank).toEqual([true]);
  });

  it('學生沒填的空格算錯', () => {
    const result = gradeClozeAnswers(['陽光', '水'], ['陽光', undefined]);
    expect(result.perBlank).toEqual([true, false]);
    expect(result.correctCount).toBe(1);
  });

  it('studentAnswers 為 undefined 時全部算錯，不會炸', () => {
    const result = gradeClozeAnswers(['陽光', '水'], undefined);
    expect(result.correctCount).toBe(0);
    expect(result.isCorrect).toBe(false);
  });

  it('沒有空格（totalBlanks=0）時 isCorrect 為 false、awardedRatio 為 0', () => {
    const result = gradeClozeAnswers([], []);
    expect(result.isCorrect).toBe(false);
    expect(result.awardedRatio).toBe(0);
  });
});

describe('findClozeCandidates', () => {
  it('抓出英文詞（≥3 字母）', () => {
    expect(findClozeCandidates('The sunlight is important')).toEqual(
      expect.arrayContaining(['The', 'sunlight', 'important']),
    );
  });

  it('抓出數字詞', () => {
    expect(findClozeCandidates('溫度是 100 度')).toEqual(expect.arrayContaining(['100']));
  });

  it('抓出 2-4 字中文詞組', () => {
    const candidates = findClozeCandidates('光合作用需要陽光、水和二氧化碳');
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('太短的英文詞（<3 字母）不算候選', () => {
    expect(findClozeCandidates('a is it')).toEqual([]);
  });
});

describe('applyRandomClozeBlanks', () => {
  it('標記數量等於 min(count, 候選詞數量)', () => {
    const body = 'The sunlight and water are important for photosynthesis';
    const result = applyRandomClozeBlanks(body, 3);
    expect(countClozeBlanks(result)).toBe(3);
  });

  it('候選詞不足時，標記數 = 候選詞數，不會炸', () => {
    const body = 'ab cd';
    const result = applyRandomClozeBlanks(body, 5);
    // ab / cd 都只有 2 個字母，不符合候選規則，維持原文不變
    expect(result).toBe(body);
  });

  it('不會重複標記已經被 [[ ]] 包住的文字', () => {
    const body = '需要[[陽光]]才能進行 photosynthesis process';
    const result = applyRandomClozeBlanks(body, 5);
    // 「陽光」已經被標記過，不應該出現 [[[[陽光]]]] 這種雙重標記
    expect(result).not.toContain('[[[[');
    expect(extractClozeAnswers(result)).toContain('陽光');
  });

  it('沒有候選詞時原樣回傳', () => {
    expect(applyRandomClozeBlanks('。，！？', 3)).toBe('。，！？');
  });
});
