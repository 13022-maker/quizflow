import { describe, expect, it } from 'vitest';

import type { GeneratedSubject } from './generate-subject';
import { buildUserPrompt, friendlyAIGenerationError, validateSemantics } from './generate-subject';

/** 3 個知識點、每點 3 題、options 長度正常一致的合法 fixture（供語意驗證測試共用） */
function buildValidSubject(): GeneratedSubject {
  const makeItem = (knowledgeId: string, n: number) => ({
    id: `${knowledgeId}-item${n}`,
    knowledgeId,
    difficulty: 0.5,
    prompt: '題幹',
    options: ['選項甲', '選項乙', '選項丙', '選項丁'],
    answerIndex: 0,
    explanation: '解析',
  });
  return {
    name: '測試學科',
    knowledgePoints: [
      { id: 'k1', name: '知識點一', prerequisites: [] },
      { id: 'k2', name: '知識點二', prerequisites: ['k1'] },
      { id: 'k3', name: '知識點三', prerequisites: ['k2'] },
    ],
    items: [
      makeItem('k1', 1),
      makeItem('k1', 2),
      makeItem('k1', 3),
      makeItem('k2', 1),
      makeItem('k2', 2),
      makeItem('k2', 3),
      makeItem('k3', 1),
      makeItem('k3', 2),
      makeItem('k3', 3),
    ],
    tutor: { lessonExampleRule: '範例規則', formatRule: '格式規則' },
  };
}

describe('buildUserPrompt', () => {
  it('沒有 material 也沒有 media：只帶主題', () => {
    const prompt = buildUserPrompt('二次函數');

    expect(prompt).toContain('二次函數');
    expect(prompt).not.toContain('<教材>');
  });

  it('有 material、無 media：包住 <教材> 區塊', () => {
    const prompt = buildUserPrompt('二次函數', '課本第三章內容...');

    expect(prompt).toContain('<教材>');
    expect(prompt).toContain('課本第三章內容...');
  });

  it('hasMedia=true：不出現 <教材> 文字區塊，改提示以檔案內容為準', () => {
    const prompt = buildUserPrompt('二次函數', undefined, true);

    expect(prompt).toContain('二次函數');
    expect(prompt).not.toContain('<教材>');
    expect(prompt).toContain('檔案');
  });
});

describe('friendlyAIGenerationError', () => {
  it('訊息含「拒絕」：回傳換主題的提示', () => {
    expect(friendlyAIGenerationError(new Error('模型拒絕輸出'))).toBe(
      '模型拒絕生成此主題的內容，請換一個主題',
    );
  });

  it('訊息含 SAFETY（Gemini 安全過濾）：回傳換主題的提示', () => {
    expect(friendlyAIGenerationError(new Error('finishReason=SAFETY'))).toBe(
      '模型拒絕生成此主題的內容，請換一個主題',
    );
  });

  it('訊息含「截斷」：回傳縮小範圍的提示', () => {
    expect(friendlyAIGenerationError(new Error('輸出被截斷'))).toBe(
      '生成內容過長被截斷，請縮小主題範圍再試',
    );
  });

  it('訊息含 MAX_TOKENS：回傳縮小範圍的提示', () => {
    expect(friendlyAIGenerationError(new Error('stop_reason=MAX_TOKENS'))).toBe(
      '生成內容過長被截斷，請縮小主題範圍再試',
    );
  });

  it('其他未知錯誤：回傳通用的稍後再試提示', () => {
    expect(friendlyAIGenerationError(new Error('ECONNRESET'))).toBe(
      'AI 服務暫時無法使用，請稍後再試',
    );
  });

  it('非 Error 物件不會炸，回傳通用提示', () => {
    expect(friendlyAIGenerationError('plain string')).toBe('AI 服務暫時無法使用，請稍後再試');
  });
});

describe('validateSemantics — 選項長度離群檢查', () => {
  it('4 個選項長度相近：不丟錯', () => {
    expect(() => validateSemantics(buildValidSubject())).not.toThrow();
  });

  it('正確答案選項明顯比其他選項長：丟出可行動的錯誤訊息', () => {
    const subject = buildValidSubject();
    subject.items[0]!.options = [
      '這是正確答案，內容寫得特別完整詳細，解釋了為什麼這是對的，字數明顯比其他三個選項長很多很多',
      '錯誤甲',
      '錯誤乙',
      '錯誤丙',
    ];
    subject.items[0]!.answerIndex = 0;

    expect(() => validateSemantics(subject)).toThrow(/選項明顯比其他選項長/);
  });

  it('錯誤選項比正確答案長：不視為離群（只防正解過長洩漏答案）', () => {
    const subject = buildValidSubject();
    subject.items[0]!.options = [
      '對',
      '這是一個寫得特別長特別詳細的錯誤選項，故意湊字數讓它比正確答案長很多很多很多',
      '錯誤乙',
      '錯誤丙',
    ];
    subject.items[0]!.answerIndex = 0;

    expect(() => validateSemantics(subject)).not.toThrow();
  });
});
