// 出題模型選項：前端顯示名稱與 route 實際呼叫的 model id 同一來源
import { describe, expect, it } from 'vitest';

import { QUIZ_MODEL_OPTIONS, resolveQuizModelChoice } from './quizModelOptions';

describe('QUIZ_MODEL_OPTIONS', () => {
  it('model id 與顯示名稱一一對應', () => {
    expect(QUIZ_MODEL_OPTIONS.gemini).toMatchObject({ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' });
    expect(QUIZ_MODEL_OPTIONS.claude).toMatchObject({ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' });
  });
});

describe('resolveQuizModelChoice', () => {
  it('非 Pro 一律送 gemini，Pro 照選擇送', () => {
    expect(resolveQuizModelChoice('claude', false)).toBe('gemini');
    expect(resolveQuizModelChoice('gemini', false)).toBe('gemini');
    expect(resolveQuizModelChoice('claude', true)).toBe('claude');
    expect(resolveQuizModelChoice('gemini', true)).toBe('gemini');
  });
});
