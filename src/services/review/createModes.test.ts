import { describe, expect, it } from 'vitest';

import {
  buildQuestionInsertFromCreated,
  countCreateContentChars,
  type CreatedQuestion,
  emptyCreatedQuestion,
  isVotableCreateContent,
  listCreateModes,
  parseCreatedQuestion,
  parseCreatedQuestionDraft,
  serializeCreatedQuestion,
  switchCreatedQuestionType,
  validateCreateContent,
  validateCreateModeSet,
} from './createModes';

const singleOk: CreatedQuestion = {
  type: 'single_choice',
  body: '台灣最高的山是哪一座？',
  options: [
    { id: 'o1', text: '玉山' },
    { id: 'o2', text: '雪山' },
    { id: 'o3', text: '合歡山' },
  ],
  correctAnswers: ['o1'],
  explanation: '玉山主峰海拔 3952 公尺',
};

const multipleOk: CreatedQuestion = {
  type: 'multiple_choice',
  body: '下列哪些是質數？',
  options: [
    { id: 'o1', text: '2' },
    { id: 'o2', text: '4' },
    { id: 'o3', text: '5' },
  ],
  correctAnswers: ['o1', 'o3'],
};

const tfOk: CreatedQuestion = {
  type: 'true_false',
  body: '水在攝氏 100 度沸騰（一大氣壓下）',
  options: [
    { id: 'tf-true', text: '正確' },
    { id: 'tf-false', text: '錯誤' },
  ],
  correctAnswers: ['tf-true'],
};

const json = (q: unknown) => JSON.stringify(q);

describe('question 共創型態開放', () => {
  it('validateCreateModeSet：free_text 與 question 都可使用', () => {
    expect(validateCreateModeSet('free_text')).toBeNull();
    expect(validateCreateModeSet('question')).toBeNull();
  });

  it('下拉選單 label 不再標示「尚未開放」', () => {
    const q = listCreateModes().find(m => m.mode === 'question')!;

    expect(q.label).toBe('小組出一道題目');
    expect(q.description).not.toContain('尚未開放');
  });
});

describe('free_text 行為不變', () => {
  it('任何內容（含空字串、壞 JSON）都通過', () => {
    expect(validateCreateContent('free_text', '')).toBeNull();
    expect(validateCreateContent('free_text', '{壞掉')).toBeNull();
    expect(validateCreateContent('free_text', '一段延伸創作')).toBeNull();
  });

  it('字數 = 原始字串長度；投票候選 = 去空白後非空', () => {
    // '一段延伸創作' 共 6 字
    expect(countCreateContentChars('free_text', '一段延伸創作')).toBe(6);
    expect(isVotableCreateContent('free_text', '  ')).toBe(false);
    expect(isVotableCreateContent('free_text', '有內容')).toBe(true);
  });
});

describe('parseCreatedQuestion：合法題目', () => {
  it.each([
    ['單選', singleOk],
    ['複選', multipleOk],
    ['是非', tfOk],
  ])('%s題 parse 成功並原樣回傳', (_label, q) => {
    expect(parseCreatedQuestion(json(q))).toEqual(q);
    expect(validateCreateContent('question', json(q))).toBeNull();
  });

  it('serialize → parse 來回一致', () => {
    expect(parseCreatedQuestion(serializeCreatedQuestion(singleOk))).toEqual(singleOk);
  });

  it('題幹與選項前後空白會被去掉', () => {
    const q = { ...singleOk, body: '  題幹  ', options: [{ id: 'a', text: ' 甲 ' }, { id: 'b', text: '乙' }], correctAnswers: ['a'] };

    expect(parseCreatedQuestion(json(q))?.body).toBe('題幹');
    expect(parseCreatedQuestion(json(q))?.options[0]?.text).toBe('甲');
  });

  it('選項 6 個、題幹剛好 500 字仍合法（邊界）', () => {
    const q = {
      ...singleOk,
      body: '字'.repeat(500),
      options: ['1', '2', '3', '4', '5', '6'].map(n => ({ id: `o${n}`, text: n })),
    };

    expect(validateCreateContent('question', json(q))).toBeNull();
  });
});

describe('validateCreateContent(question)：不合法題目回傳具體繁中錯誤', () => {
  it('空字串 → 請先完成題目', () => {
    expect(validateCreateContent('question', '')).toBe('請先完成題目再送出');
  });

  it('壞 JSON → 格式錯誤', () => {
    expect(parseCreatedQuestion('{"type":')).toBeNull();
    expect(validateCreateContent('question', '{"type":')).toBe('題目格式錯誤，請重新編輯');
  });

  it('JSON 不是物件（例如自由文字或陣列）→ 格式錯誤', () => {
    expect(validateCreateContent('question', '我是自由文字')).toBe('題目格式錯誤，請重新編輯');
    expect(validateCreateContent('question', '[1,2]')).toBe('題目格式錯誤，請重新編輯');
  });

  it('題幹空白', () => {
    expect(validateCreateContent('question', json({ ...singleOk, body: '   ' }))).toBe('請輸入題幹');
  });

  it('題幹 501 字', () => {
    expect(validateCreateContent('question', json({ ...singleOk, body: '字'.repeat(501) }))).toBe('題幹最多 500 字');
  });

  it('不認識的題型', () => {
    expect(validateCreateContent('question', json({ ...singleOk, type: 'short_answer' }))).toBe('題型只能是單選、複選或是非');
  });

  it('單選只有 1 個選項', () => {
    const q = { ...singleOk, options: [{ id: 'o1', text: '玉山' }] };

    expect(validateCreateContent('question', json(q))).toBe('選項需要 2 到 6 個');
  });

  it('複選有 7 個選項', () => {
    const q = { ...multipleOk, options: ['1', '2', '3', '4', '5', '6', '7'].map(n => ({ id: `o${n}`, text: n })) };

    expect(validateCreateContent('question', json(q))).toBe('選項需要 2 到 6 個');
  });

  it('選項內容空白', () => {
    const q = { ...singleOk, options: [{ id: 'o1', text: '玉山' }, { id: 'o2', text: ' ' }] };

    expect(validateCreateContent('question', json(q))).toBe('選項內容不能空白');
  });

  it('選項超過 200 字', () => {
    const q = { ...singleOk, options: [{ id: 'o1', text: '玉山' }, { id: 'o2', text: '字'.repeat(201) }] };

    expect(validateCreateContent('question', json(q))).toBe('每個選項最多 200 字');
  });

  it('選項 id 重複', () => {
    const q = { ...singleOk, options: [{ id: 'o1', text: '玉山' }, { id: 'o1', text: '雪山' }] };

    expect(validateCreateContent('question', json(q))).toBe('選項代號重複，請重新編輯');
  });

  it('單選沒選正確答案', () => {
    expect(validateCreateContent('question', json({ ...singleOk, correctAnswers: [] }))).toBe('請選擇正確答案');
  });

  it('單選選了 2 個正確答案', () => {
    expect(validateCreateContent('question', json({ ...singleOk, correctAnswers: ['o1', 'o2'] }))).toBe('單選題只能有 1 個正確答案');
  });

  it('複選沒選正確答案', () => {
    expect(validateCreateContent('question', json({ ...multipleOk, correctAnswers: [] }))).toBe('正確答案至少要選 1 個');
  });

  it('正確答案指向不存在的選項', () => {
    expect(validateCreateContent('question', json({ ...multipleOk, correctAnswers: ['o1', 'o9'] }))).toBe('正確答案必須是現有的選項');
  });

  it('複選正確答案重複', () => {
    expect(validateCreateContent('question', json({ ...multipleOk, correctAnswers: ['o1', 'o1'] }))).toBe('正確答案重複');
  });

  it('是非題選項不是 tf-true / tf-false', () => {
    const q = { ...tfOk, options: [{ id: 'o1', text: '對' }, { id: 'o2', text: '錯' }], correctAnswers: ['o1'] };

    expect(validateCreateContent('question', json(q))).toBe('是非題選項必須是「正確」與「錯誤」');
  });

  it('是非題兩個都選', () => {
    expect(validateCreateContent('question', json({ ...tfOk, correctAnswers: ['tf-true', 'tf-false'] }))).toBe('是非題只能有 1 個正確答案');
  });

  it('解析 501 字', () => {
    expect(validateCreateContent('question', json({ ...singleOk, explanation: '字'.repeat(501) }))).toBe('解析最多 500 字');
  });
});

describe('emptyCreatedQuestion', () => {
  it('單選：4 個空白選項、id 不重複、沒有正確答案', () => {
    const q = emptyCreatedQuestion('single_choice');

    expect(q.type).toBe('single_choice');
    expect(q.body).toBe('');
    expect(q.options).toHaveLength(4);
    expect(new Set(q.options.map(o => o.id)).size).toBe(4);
    expect(q.correctAnswers).toEqual([]);
  });

  it('是非：固定 tf-true / tf-false', () => {
    expect(emptyCreatedQuestion('true_false').options).toEqual([
      { id: 'tf-true', text: '正確' },
      { id: 'tf-false', text: '錯誤' },
    ]);
  });

  it('空白題目本身不合法（送出會被擋）', () => {
    expect(parseCreatedQuestion(serializeCreatedQuestion(emptyCreatedQuestion('multiple_choice')))).toBeNull();
  });
});

describe('parseCreatedQuestionDraft：寬鬆讀半成品（編輯器與「未完成」預覽用）', () => {
  it('空字串 / 壞 JSON / 非物件 → null', () => {
    expect(parseCreatedQuestionDraft('')).toBeNull();
    expect(parseCreatedQuestionDraft('{"body":')).toBeNull();
    expect(parseCreatedQuestionDraft('"字串"')).toBeNull();
  });

  it('只填了題幹 → 保留題幹，其餘補預設（單選、無選項、無答案）', () => {
    expect(parseCreatedQuestionDraft('{"body":"寫到一半"}')).toEqual({
      type: 'single_choice',
      body: '寫到一半',
      options: [],
      correctAnswers: [],
      explanation: '',
    });
  });

  it('欄位型別錯亂時丟掉壞的部分，不會 crash', () => {
    const raw = json({ type: 'xx', body: 3, options: [{ id: 'a', text: '甲' }, 'bad', { id: 1 }], correctAnswers: ['a', 2], explanation: null });

    expect(parseCreatedQuestionDraft(raw)).toEqual({
      type: 'single_choice',
      body: '',
      options: [{ id: 'a', text: '甲' }],
      correctAnswers: ['a'],
      explanation: '',
    });
  });

  it('不去空白（編輯中打的空格要保留）', () => {
    expect(parseCreatedQuestionDraft('{"body":"題幹 "}')?.body).toBe('題幹 ');
  });
});

describe('countCreateContentChars(question)：只算題幹＋選項＋解析，不算 JSON 結構', () => {
  it('單選：題幹 11 + 選項 2+2+3 + 解析 14 = 32', () => {
    // '台灣最高的山是哪一座？' 11 字；'玉山' 2、'雪山' 2、'合歡山' 3；
    // '玉山主峰海拔 3952 公尺' = 6 + 空白 1 + 4 + 空白 1 + 2 = 14 字
    expect(countCreateContentChars('question', json(singleOk))).toBe(32);
  });

  it('是非題固定選項（正確/錯誤）不算字數：題幹 19', () => {
    // '水在攝氏 100 度沸騰（一大氣壓下）' = 4 + 1 + 3 + 1 + 3 + 7 = 19 字
    expect(countCreateContentChars('question', json(tfOk))).toBe(19);
  });

  it('空白題目 → 0（打開編輯器但還沒寫字不算動手）', () => {
    expect(countCreateContentChars('question', serializeCreatedQuestion(emptyCreatedQuestion('single_choice')))).toBe(0);
  });

  it('壞 JSON / 舊的自由文字草稿 → 退回原始字串長度', () => {
    // '舊草稿' 3 字
    expect(countCreateContentChars('question', '舊草稿')).toBe(3);
    expect(countCreateContentChars('question', '')).toBe(0);
  });
});

describe('isVotableCreateContent(question)：未完成題目不列入投票候選', () => {
  it('合法題目可投、半成品與空字串不可投', () => {
    expect(isVotableCreateContent('question', json(singleOk))).toBe(true);
    expect(isVotableCreateContent('question', json({ ...singleOk, correctAnswers: [] }))).toBe(false);
    expect(isVotableCreateContent('question', '')).toBe(false);
  });
});

describe('switchCreatedQuestionType：編輯器切換題型', () => {
  const draft = { ...multipleOk, explanation: '解析' };

  it('複選 → 單選：保留選項與題幹，正確答案只留第一個', () => {
    expect(switchCreatedQuestionType(draft, 'single_choice')).toEqual({
      type: 'single_choice',
      body: '下列哪些是質數？',
      options: multipleOk.options,
      correctAnswers: ['o1'],
      explanation: '解析',
    });
  });

  it('單選 → 是非：選項換成固定正確/錯誤、清空正確答案，題幹與解析保留', () => {
    expect(switchCreatedQuestionType(draft, 'true_false')).toEqual({
      type: 'true_false',
      body: '下列哪些是質數？',
      options: [{ id: 'tf-true', text: '正確' }, { id: 'tf-false', text: '錯誤' }],
      correctAnswers: [],
      explanation: '解析',
    });
  });

  it('是非 → 複選：換成 4 個空白選項、清空正確答案', () => {
    const next = switchCreatedQuestionType({ ...tfOk, explanation: '' }, 'multiple_choice');

    expect(next.type).toBe('multiple_choice');
    expect(next.body).toBe(tfOk.body);
    expect(next.options.map(o => o.text)).toEqual(['', '', '', '']);
    expect(next.options.some(o => o.id.startsWith('tf-'))).toBe(false);
    expect(next.correctAnswers).toEqual([]);
  });
});

describe('buildQuestionInsertFromCreated：匯入正式題庫的欄位', () => {
  it('單選：沿用 question 表欄位，points 1、position 由呼叫端給', () => {
    expect(buildQuestionInsertFromCreated(singleOk, 7, 3)).toEqual({
      quizId: 7,
      type: 'single_choice',
      body: '台灣最高的山是哪一座？',
      options: singleOk.options,
      correctAnswers: ['o1'],
      explanation: '玉山主峰海拔 3952 公尺',
      points: 1,
      position: 3,
    });
  });

  it('沒有解析或解析空白 → explanation 存 null', () => {
    expect(buildQuestionInsertFromCreated(multipleOk, 1, 1).explanation).toBeNull();
    expect(buildQuestionInsertFromCreated({ ...tfOk, explanation: '' }, 1, 1).explanation).toBeNull();
  });

  it('是非題選項文字一律存標準的「正確」「錯誤」', () => {
    const q = { ...tfOk, options: [{ id: 'tf-true', text: '對' }, { id: 'tf-false', text: '錯' }] };

    expect(buildQuestionInsertFromCreated(q, 1, 1).options).toEqual([
      { id: 'tf-true', text: '正確' },
      { id: 'tf-false', text: '錯誤' },
    ]);
  });
});
