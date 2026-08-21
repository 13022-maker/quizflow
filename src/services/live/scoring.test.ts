import { describe, expect, it } from 'vitest';

import { gradeAnswer, isLiveSupportedType, LIVE_SUPPORTED_TYPES } from './scoring';

describe('LIVE_SUPPORTED_TYPES / isLiveSupportedType', () => {
  it('listening 是支援題型', () => {
    expect(LIVE_SUPPORTED_TYPES).toContain('listening');
    expect(isLiveSupportedType('listening')).toBe(true);
  });

  it('ranking / short_answer / cloze 仍不支援', () => {
    expect(isLiveSupportedType('ranking')).toBe(false);
    expect(isLiveSupportedType('short_answer')).toBe(false);
    expect(isLiveSupportedType('cloze')).toBe(false);
  });
});

describe('gradeAnswer - listening', () => {
  it('選對唯一正解時回傳 true', () => {
    expect(gradeAnswer('listening', ['b'], 'b')).toBe(true);
  });

  it('選錯時回傳 false', () => {
    expect(gradeAnswer('listening', ['b'], 'a')).toBe(false);
  });

  it('selectedOptionId 是陣列（誤送多選格式）時回傳 false', () => {
    expect(gradeAnswer('listening', ['b'], ['b'])).toBe(false);
  });

  it('沒有正解時回傳 false', () => {
    expect(gradeAnswer('listening', [], 'b')).toBe(false);
    expect(gradeAnswer('listening', null, 'b')).toBe(false);
  });
});
