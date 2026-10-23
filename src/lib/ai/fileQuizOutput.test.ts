import { describe, expect, it } from 'vitest';

import {
  AIOutputError,
  claudeStopReasonError,
  EMPTY_CONTENT_MESSAGE,
  geminiFinishReasonError,
  normalizeMcAnswer,
  parseTypesField,
  RECITATION_MESSAGE,
  SAFETY_MESSAGE,
  TRUNCATED_MESSAGE,
  validateGeneratedQuestions,
} from './fileQuizOutput';

describe('normalizeMcAnswer', () => {
  it.each([
    ['A', 'A'],
    ['(A)', 'A'],
    ['A.', 'A'],
    ['（B）', 'B'],
    ['c', 'C'],
    [' (d) ', 'D'],
    ['Ｄ．', null], // 全形字母不在規格內
    ['B．', 'B'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeMcAnswer(input)).toBe(expected);
  });

  it('不是單一字母的答案回傳 null（交給呼叫端用選項文字比對）', () => {
    expect(normalizeMcAnswer('光合作用')).toBeNull();
    expect(normalizeMcAnswer('AB')).toBeNull();
    expect(normalizeMcAnswer('E')).toBeNull();
    expect(normalizeMcAnswer('')).toBeNull();
  });
});

describe('validateGeneratedQuestions', () => {
  const goodMc = { type: 'mc', question: '葉綠素主要吸收哪種光？', options: ['(A)紅光', '(B)綠光', '(C)紫外線', '(D)紅外線'], answer: '(A)', explanation: '說明' };

  it('選擇題答案「(A)」正規化成「A」，其他欄位原樣保留', () => {
    const { questions, dropped } = validateGeneratedQuestions([{ ...goodMc, diagram: { type: 'flow', steps: ['a', 'b'] } }]);

    expect(dropped).toBe(0);
    expect(questions).toEqual([{ ...goodMc, answer: 'A', diagram: { type: 'flow', steps: ['a', 'b'] } }]);
  });

  it('聽力題同樣正規化答案', () => {
    const { questions } = validateGeneratedQuestions([{ ...goodMc, type: 'listening', answer: '（C）', listeningText: '文字' }]);

    expect(questions[0]!.answer).toBe('C');
  });

  it('選擇題答案寫選項文字本身也接受（questionRows 會用文字比對）', () => {
    const { questions, dropped } = validateGeneratedQuestions([{ ...goodMc, answer: '紅光' }]);

    expect(dropped).toBe(0);
    expect(questions[0]!.answer).toBe('紅光');
  });

  it('缺題幹 / 題幹空白 → 丟棄', () => {
    const { questions, dropped } = validateGeneratedQuestions([
      { ...goodMc, question: '' },
      { ...goodMc, question: '   ' },
      { type: 'tf', answer: '○' },
    ]);

    expect(questions).toEqual([]);
    expect(dropped).toBe(3);
  });

  it('選擇題少於 2 個選項、或有選項剝掉字母前綴後是空的 → 丟棄', () => {
    const { questions, dropped } = validateGeneratedQuestions([
      { ...goodMc, options: ['(A)紅光'] },
      { ...goodMc, options: ['(A)紅光', '(B)', '(C)紫外線', '(D)紅外線'] },
      { ...goodMc, options: undefined },
    ]);

    expect(questions).toEqual([]);
    expect(dropped).toBe(3);
  });

  it('選擇題缺答案、答案字母超出選項數、答案對不到任何選項 → 丟棄', () => {
    const { questions, dropped } = validateGeneratedQuestions([
      { ...goodMc, answer: undefined },
      { ...goodMc, options: ['(A)紅光', '(B)綠光'], answer: 'D' },
      { ...goodMc, answer: '藍光' },
    ]);

    expect(questions).toEqual([]);
    expect(dropped).toBe(3);
  });

  it('是非、填空、簡答缺答案 → 丟棄；有答案保留', () => {
    const { questions, dropped } = validateGeneratedQuestions([
      { type: 'tf', question: '植物會行光合作用', answer: '○' },
      { type: 'tf', question: '植物會行光合作用' },
      { type: 'fill', question: '植物用 ___ 吸收光', answer: '葉綠素' },
      { type: 'fill', question: '植物用 ___ 吸收光', answer: ' ' },
      { type: 'short', question: '說明光合作用', answer: '參考答案' },
      { type: 'short', question: '說明光合作用' },
    ]);

    expect(questions.map(q => q.type)).toEqual(['tf', 'fill', 'short']);
    expect(dropped).toBe(3);
  });

  it('克漏字不需要 answer；排序題需要至少 2 個選項', () => {
    const { questions, dropped } = validateGeneratedQuestions([
      { type: 'cloze', question: '植物利用[[葉綠素]]吸收[[陽光]]。' },
      { type: 'rank', question: '排序', options: ['甲', '乙', '丙'], answer: ['甲', '乙', '丙'] },
      { type: 'rank', question: '排序', options: ['甲'], answer: ['甲'] },
    ]);

    expect(questions.map(q => q.type)).toEqual(['cloze', 'rank']);
    expect(dropped).toBe(1);
  });

  it('非物件元素、未知題型 → 丟棄', () => {
    const { questions, dropped } = validateGeneratedQuestions([null, 'abc', 42, { type: 'essay', question: '題目', answer: 'x' }]);

    expect(questions).toEqual([]);
    expect(dropped).toBe(4);
  });
});

describe('parseTypesField', () => {
  it('未傳 → 預設 ["mc"]', () => {
    expect(parseTypesField(null)).toEqual({ ok: true, types: ['mc'] });
    expect(parseTypesField('')).toEqual({ ok: true, types: ['mc'] });
  });

  it('合法 JSON 陣列 → 原樣回傳', () => {
    expect(parseTypesField('["mc","tf","listening"]')).toEqual({ ok: true, types: ['mc', 'tf', 'listening'] });
  });

  it('不是合法 JSON → 400 錯誤而不是 throw', () => {
    const r = parseTypesField('[mc');

    expect(r.ok).toBe(false);
  });

  it('不是字串陣列、空陣列、含未知題型 → 錯誤', () => {
    expect(parseTypesField('"mc"').ok).toBe(false);
    expect(parseTypesField('[1,2]').ok).toBe(false);
    expect(parseTypesField('[]').ok).toBe(false);
    expect(parseTypesField('["mc","essay"]').ok).toBe(false);
  });
});

describe('geminiFinishReasonError', () => {
  it('STOP / 未提供 → 沒有錯誤', () => {
    expect(geminiFinishReasonError('STOP')).toBeNull();
    expect(geminiFinishReasonError(undefined)).toBeNull();
  });

  it('MAX_TOKENS → truncated', () => {
    const err = geminiFinishReasonError('MAX_TOKENS');

    expect(err).toBeInstanceOf(AIOutputError);
    expect(err!.kind).toBe('truncated');
    expect(err!.userMessage).toBe(TRUNCATED_MESSAGE);
  });

  it('RECITATION → 照抄原文提示', () => {
    expect(geminiFinishReasonError('RECITATION')!.userMessage).toBe(RECITATION_MESSAGE);
  });

  it('SAFETY / PROHIBITED_CONTENT / BLOCKLIST → 安全過濾提示', () => {
    expect(geminiFinishReasonError('SAFETY')!.userMessage).toBe(SAFETY_MESSAGE);
    expect(geminiFinishReasonError('PROHIBITED_CONTENT')!.userMessage).toBe(SAFETY_MESSAGE);
    expect(geminiFinishReasonError('BLOCKLIST')!.userMessage).toBe(SAFETY_MESSAGE);
  });

  it('其他異常 finishReason → 通用訊息，不洩漏內部代碼', () => {
    const err = geminiFinishReasonError('MALFORMED_FUNCTION_CALL')!;

    expect(err.kind).toBe('other');
    expect(err.userMessage).not.toContain('MALFORMED');
    expect(err.userMessage).not.toContain('GEMINI');
  });
});

describe('claudeStopReasonError', () => {
  it('end_turn → 沒有錯誤；max_tokens → 截斷；refusal → 安全過濾', () => {
    expect(claudeStopReasonError('end_turn')).toBeNull();
    expect(claudeStopReasonError('max_tokens')!.userMessage).toBe(TRUNCATED_MESSAGE);
    expect(claudeStopReasonError('refusal')!.userMessage).toBe(SAFETY_MESSAGE);
  });
});

describe('訊息文字', () => {
  it('依規格輸出繁中訊息', () => {
    expect(TRUNCATED_MESSAGE).toBe('題數太多，AI 輸出被截斷，請減少題型或每種題數後再試');
    expect(RECITATION_MESSAGE).toBe('AI 偵測到大量照抄原文，請改出理解型題目或縮小頁數範圍');
    expect(SAFETY_MESSAGE).toBe('內容觸發安全過濾，請更換頁面範圍');
    expect(EMPTY_CONTENT_MESSAGE).toBe('這幾頁內容不足以出題（可能是空白或掃描不清），請換頁面範圍');
  });
});
