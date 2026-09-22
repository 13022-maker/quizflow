import { describe, expect, it } from 'vitest';

import {
  buildLessonPrepPrompt,
  DEFAULT_LESSON_PREP_STAGES,
  type LessonPrepStageConfig,
} from './lessonPrepPromptBuilder';

describe('buildLessonPrepPrompt', () => {
  it('預設 6 個階段都出現在輸出的 quizzes 陣列裡，且順序跟輸入一致', () => {
    const prompt = buildLessonPrepPrompt(DEFAULT_LESSON_PREP_STAGES);

    const stageOrder = DEFAULT_LESSON_PREP_STAGES.map(s => s.key);
    const indices = stageOrder.map(key => prompt.indexOf(`"stage": "${key}"`));

    expect(indices.every(i => i !== -1)).toBe(true);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it('每個階段的題數會反映在 quizzes 陣列的 x{count} 標記上', () => {
    const prompt = buildLessonPrepPrompt(DEFAULT_LESSON_PREP_STAGES);

    expect(prompt).toContain('"stage": "pretest", "title": "診斷測驗 - <單元>", "questions": [ <question> x5 ]');
    expect(prompt).toContain('"stage": "deepen", "title": "深化排序 - <單元>", "questions": [ <question> x2 ]');
  });

  it('題數設為 0 的階段，整列從 quizzes 陣列跟產題規則裡消失', () => {
    const stages: LessonPrepStageConfig[] = DEFAULT_LESSON_PREP_STAGES.map(s =>
      s.key === 'practice_challenge' ? { ...s, count: 0 } : s,
    );
    const prompt = buildLessonPrepPrompt(stages);

    expect(prompt).not.toContain('"stage": "practice_challenge"');
    expect(prompt).not.toContain('挑戰練習（practice_challenge');
  });

  it('一個階段勾選多個題型時，產題規則會列出所有題型並用頓號分隔', () => {
    const stages: LessonPrepStageConfig[] = DEFAULT_LESSON_PREP_STAGES.map(s =>
      s.key === 'pretest' ? { ...s, types: ['mc', 'tf', 'cloze'] as const } : s,
    ) as LessonPrepStageConfig[];
    const prompt = buildLessonPrepPrompt(stages);

    expect(prompt).toContain('可用題型 mc、tf、cloze');
  });

  it('全部階段題數都是 0 時，quizzes 陣列跟產題規則的階段清單都是空的，但不會噴錯', () => {
    const stages: LessonPrepStageConfig[] = DEFAULT_LESSON_PREP_STAGES.map(s => ({ ...s, count: 0 }));

    expect(() => buildLessonPrepPrompt(stages)).not.toThrow();

    const prompt = buildLessonPrepPrompt(stages);

    expect(prompt).not.toContain('"stage":');
  });

  it('輸出仍然包含固定不變的「各題型規則」與「輸出：單一 JSON 物件」等區塊', () => {
    const prompt = buildLessonPrepPrompt(DEFAULT_LESSON_PREP_STAGES);

    expect(prompt).toContain('# 各題型規則');
    expect(prompt).toContain('# 輸出：單一 JSON 物件');
    expect(prompt).toContain('# 產題規則');
    expect(prompt).toContain('不使用 "listening"');
    expect(prompt).toContain('不要輸出 imageUrl / diagramSvg / audioUrl / position 等欄位');
  });
});
