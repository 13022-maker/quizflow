import { describe, expect, it } from 'vitest';

import { parseSubmitInput } from './submitValidation';

// 基準合法 payload（各測試以此為底修改單一欄位）
const validInput = {
  quizId: 1,
  studentName: '王小明',
  studentEmail: 'student@example.com',
  answers: { 1: 'opt-a', 2: ['opt-b', 'opt-c'] },
};

describe('parseSubmitInput', () => {
  it('合法輸入應通過並回傳資料', () => {
    const result = parseSubmitInput(validInput);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.data.quizId).toBe(1);
      expect(result.data.studentEmail).toBe('student@example.com');
    }
  });

  it('email 頭尾空白應自動修剪後通過（手機鍵盤常自動補空格）', () => {
    const result = parseSubmitInput({ ...validInput, studentEmail: ' student@example.com ' });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.data.studentEmail).toBe('student@example.com');
    }
  });

  it('email 格式不合法應回傳友善錯誤訊息（不 throw）', () => {
    const result = parseSubmitInput({ ...validInput, studentEmail: '王小明' });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toContain('Email');
    }
  });

  it('姓名與 email 為選填，省略時應通過', () => {
    const result = parseSubmitInput({ quizId: 1, answers: { 1: 'opt-a' } });

    expect(result.ok).toBe(true);
  });

  it('quizId 非正整數應回傳錯誤', () => {
    const result = parseSubmitInput({ ...validInput, quizId: -1 });

    expect(result.ok).toBe(false);
  });

  it('answers 內含非字串值應回傳錯誤', () => {
    const result = parseSubmitInput({ ...validInput, answers: { 1: 123 } });

    expect(result.ok).toBe(false);
  });
});
