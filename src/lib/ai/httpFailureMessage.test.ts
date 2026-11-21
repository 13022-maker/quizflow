import { describe, expect, it } from 'vitest';

import { AI_TIMEOUT_MESSAGE, describeAiHttpFailure } from './httpFailureMessage';

describe('describeAiHttpFailure', () => {
  it('504（Vercel FUNCTION_INVOCATION_TIMEOUT 或 route 自己回的逾時）：提示減少頁數或題數', () => {
    expect(describeAiHttpFailure(504)).toBe(AI_TIMEOUT_MESSAGE);
    expect(AI_TIMEOUT_MESSAGE).toContain('減少頁數或題數');
  });

  it('413：檔案太大', () => {
    expect(describeAiHttpFailure(413)).toContain('檔案太大');
  });

  it('其他 5xx：帶狀態碼的伺服器錯誤訊息', () => {
    expect(describeAiHttpFailure(502)).toBe('AI 服務暫時無法回應（HTTP 502），請稍後再試');
  });

  it('其他狀態：帶狀態碼的通用失敗訊息', () => {
    expect(describeAiHttpFailure(404)).toBe('命題失敗（HTTP 404），請重試');
  });
});
