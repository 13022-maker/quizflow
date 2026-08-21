import { describe, expect, it } from 'vitest';

import { getEffectiveQuestionDuration, LISTENING_FALLBACK_SEC } from './questionDuration';

describe('getEffectiveQuestionDuration', () => {
  it('非聽力題型不受影響，直接回傳基礎時長', () => {
    expect(
      getEffectiveQuestionDuration({ type: 'single_choice', audioDurationSec: 30 }, 20),
    ).toBe(20);
  });

  it('聽力題有偵測到音檔長度時，基礎時長 + 音檔秒數', () => {
    expect(
      getEffectiveQuestionDuration({ type: 'listening', audioDurationSec: 18 }, 20),
    ).toBe(38);
  });

  it('聽力題沒偵測到音檔長度（null）時，套用固定 15 秒寬限', () => {
    expect(
      getEffectiveQuestionDuration({ type: 'listening', audioDurationSec: null }, 20),
    ).toBe(20 + LISTENING_FALLBACK_SEC);
  });

  it('聽力題 audioDurationSec 欄位缺省（undefined）時，同樣套用寬限', () => {
    expect(
      getEffectiveQuestionDuration({ type: 'listening' }, 25),
    ).toBe(25 + LISTENING_FALLBACK_SEC);
  });
});
