import { describe, expect, it } from 'vitest';

import { buildFigureLocatorRule, buildFigureRuleForSource, buildNoFigureReferenceRule } from './figureReferencePrompt';
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

describe('buildFigureLocatorRule', () => {
  it('允許題幹寫「如圖所示」並要求輸出 figure 欄位（page + bbox）', () => {
    const rule = buildFigureLocatorRule();

    expect(rule).toContain('【圖表依賴規則】');
    expect(rule).toContain('如圖所示');
    expect(rule).toContain('"figure"');
    expect(rule).toContain('page');
    expect(rule).toContain('bbox');
  });

  it('要求題幹精簡、不要把整張圖改寫成長段文字', () => {
    const rule = buildFigureLocatorRule();

    expect(rule).toContain('精簡');
    expect(rule).not.toContain('完整寫進題目');
  });

  it('找不到圖的位置就不要出依賴圖的題目', () => {
    expect(buildFigureLocatorRule()).toContain('不要出這題');
  });

  it('圖片來源時 page 指第幾張圖片', () => {
    expect(buildFigureLocatorRule('question', 'image')).toContain('第幾張圖片');
  });
});

describe('buildFigureRuleForSource', () => {
  it('PDF / 圖片來源 → 截圖定位版本', () => {
    expect(buildFigureRuleForSource('pdf')).toBe(buildFigureLocatorRule('question', 'pdf'));
    expect(buildFigureRuleForSource('image')).toBe(buildFigureLocatorRule('question', 'image'));
  });

  it('純文字來源 → 維持 PR #119 的「改寫成文字」版本', () => {
    expect(buildFigureRuleForSource('text')).toBe(buildNoFigureReferenceRule());
    expect(buildFigureRuleForSource('text', 'content')).toBe(buildNoFigureReferenceRule('content'));
  });
});
