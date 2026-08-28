import { describe, expect, it } from 'vitest';

import { buildUserPrompt, friendlyAIGenerationError } from './generate-subject';

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
