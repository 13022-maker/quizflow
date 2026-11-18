import { describe, expect, it } from 'vitest';

import { buildNoFigureReferenceRule } from './figureReferencePrompt';
import { buildLessonPrepPrompt, DEFAULT_LESSON_PREP_STAGES } from './lessonPrepPromptBuilder';

describe('buildNoFigureReferenceRule', () => {
  it('禁止題幹出現「如圖／如右圖／下圖／附圖／圖一／下表」等圖表參照字樣', () => {
    const rule = buildNoFigureReferenceRule();

    expect(rule).toContain('【圖表依賴規則】');

    for (const word of ['如圖', '如右圖', '下圖', '附圖', '圖一', '下表']) {
      expect(rule).toContain(word);
    }
  });

  it('要求把看圖題（例如電路圖）的資訊完整改寫成文字，寫不出來就不要出', () => {
    const rule = buildNoFigureReferenceRule();

    expect(rule).toContain('電路');
    expect(rule).toContain('文字');
    expect(rule).toContain('不要出這題');
  });

  it('可指定題目文字所在欄位名稱', () => {
    expect(buildNoFigureReferenceRule()).toContain('question 欄位');
    expect(buildNoFigureReferenceRule('content')).toContain('content 欄位');
  });
});

describe('buildLessonPrepPrompt', () => {
  it('備課 prompt 包含圖表依賴規則', () => {
    expect(buildLessonPrepPrompt(DEFAULT_LESSON_PREP_STAGES)).toContain('【圖表依賴規則】');
  });
});
