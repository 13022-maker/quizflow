import { describe, expect, it } from 'vitest';

import {
  buildChoiceAnswerKey,
  buildClassroomShareUrl,
  buildFillBlankAnswerKey,
  buildSubmissionResultHtml,
  generateResultToken,
  isValidResultToken,
  MAX_SUBMISSION_BODY_BYTES,
  parsePracticePageAnswerKey,
  parsePracticePageSubmission,
  scorePracticePageSubmission,
  submissionsToCsv,
} from './practicePageSubmission';

const SID = '6f1c2b1e-8a4b-4c47-9a5f-3f7e6c1d2b10';

describe('buildChoiceAnswerKey / buildFillBlankAnswerKey', () => {
  it('選擇題答案表只留 correctIndex、選項數、題目 id（不帶題目文字）', () => {
    const key = buildChoiceAnswerKey([
      { groupLabel: 'g', question: 'Q1', options: ['a', 'b', 'c', 'd'], correctIndex: 2, id: 11 },
      { groupLabel: 'g', question: 'Q2', options: ['正確', '錯誤'], correctIndex: 0 },
    ]);

    expect(key).toEqual({
      kind: 'choice',
      items: [
        { correctIndex: 2, optionCount: 4, questionId: 11 },
        { correctIndex: 0, optionCount: 2, questionId: null },
      ],
    });
  });

  it('填空題答案表帶答案與扣分百分比', () => {
    const key = buildFillBlankAnswerKey(
      [{ groupLabel: 'g', before: '台灣最高峰是', after: '。', answer: '玉山' }],
      3,
    );

    expect(key).toEqual({ kind: 'fillblank', hintPenaltyPercent: 3, items: [{ answer: '玉山' }] });
  });

  it('parsePracticePageAnswerKey：DB 讀回來的 jsonb 格式不對就回 null', () => {
    expect(parsePracticePageAnswerKey(null)).toBeNull();
    expect(parsePracticePageAnswerKey({ kind: 'choice', items: 'x' })).toBeNull();
    expect(parsePracticePageAnswerKey({ kind: 'choice', items: [{ correctIndex: 1, optionCount: 4, questionId: null }] }))
      .toEqual({ kind: 'choice', items: [{ correctIndex: 1, optionCount: 4, questionId: null }] });
  });
});

describe('parsePracticePageSubmission', () => {
  const valid = {
    sessionId: SID,
    className: ' 301 ',
    studentName: ' 王小明 ',
    answers: [1, -1, { typed: 'abc', hintUses: 2 }],
  };

  it('合法輸入：班級姓名 trim，答案保留', () => {
    const r = parsePracticePageSubmission(JSON.stringify(valid));

    expect(r).toEqual({
      ok: true,
      submission: {
        sessionId: SID,
        className: '301',
        studentName: '王小明',
        answers: [1, -1, { typed: 'abc', hintUses: 2 }],
      },
    });
  });

  it('班級或姓名空白 → 拒絕', () => {
    expect(parsePracticePageSubmission(JSON.stringify({ ...valid, className: '   ' })).ok).toBe(false);
    expect(parsePracticePageSubmission(JSON.stringify({ ...valid, studentName: '' })).ok).toBe(false);
    expect(parsePracticePageSubmission(JSON.stringify({ ...valid, studentName: 123 })).ok).toBe(false);
  });

  it('過長的班級/姓名/填空內容會被截斷，而不是整筆拒絕', () => {
    const r = parsePracticePageSubmission(JSON.stringify({
      ...valid,
      className: 'A'.repeat(500),
      studentName: '王'.repeat(500),
      answers: [{ typed: 'x'.repeat(5000), hintUses: 0 }],
    }));

    expect(r.ok).toBe(true);

    if (r.ok) {
      expect(r.submission.className).toHaveLength(40);
      expect(r.submission.studentName).toHaveLength(40);
      expect((r.submission.answers[0] as { typed: string }).typed).toHaveLength(100);
    }
  });

  it('sessionId 不是 UUID、不是 JSON、body 過大、答案太多題 → 拒絕', () => {
    expect(parsePracticePageSubmission(JSON.stringify({ ...valid, sessionId: 'abc' })).ok).toBe(false);
    expect(parsePracticePageSubmission('not json').ok).toBe(false);
    expect(parsePracticePageSubmission('x'.repeat(MAX_SUBMISSION_BODY_BYTES + 1)).ok).toBe(false);
    expect(parsePracticePageSubmission(JSON.stringify({ ...valid, answers: Array.from({ length: 501 }).fill(0) })).ok).toBe(false);
  });

  it('答案格式不合法（選項 index 超界、hintUses 負數、非整數）→ 拒絕', () => {
    expect(parsePracticePageSubmission(JSON.stringify({ ...valid, answers: [99] })).ok).toBe(false);
    expect(parsePracticePageSubmission(JSON.stringify({ ...valid, answers: [1.5] })).ok).toBe(false);
    expect(parsePracticePageSubmission(JSON.stringify({ ...valid, answers: [{ typed: 'a', hintUses: -1 }] })).ok).toBe(false);
    expect(parsePracticePageSubmission(JSON.stringify({ ...valid, answers: ['A'] })).ok).toBe(false);
  });
});

describe('scorePracticePageSubmission：server 依答案表重算分數，不信任 client 分數', () => {
  const choiceKey = buildChoiceAnswerKey([
    { groupLabel: 'g', question: 'Q1', options: ['a', 'b', 'c', 'd'], correctIndex: 1 },
    { groupLabel: 'g', question: 'Q2', options: ['a', 'b', 'c', 'd'], correctIndex: 2 },
    { groupLabel: 'g', question: 'Q3', options: ['a', 'b'], correctIndex: 0 },
  ]);

  it('選擇題：每題 floor(100/3)=33 分、最後一題補到 34；答對 1、3 題 → 67 分', () => {
    const r = scorePracticePageSubmission(choiceKey, [1, 0, 0]);

    expect(r.ok).toBe(true);

    if (r.ok) {
      expect(r.score).toBe(67);
      expect(r.maxScore).toBe(100);
      expect(r.detail).toEqual({
        kind: 'choice',
        total: 3,
        correctCount: 2,
        items: [
          { index: 0, correct: true, points: 33, maxPoints: 33, chosen: 1 },
          { index: 1, correct: false, points: 0, maxPoints: 33, chosen: 0 },
          { index: 2, correct: true, points: 34, maxPoints: 34, chosen: 0 },
        ],
      });
    }
  });

  it('選擇題：全對 100 分；未作答（-1）算錯', () => {
    const all = scorePracticePageSubmission(choiceKey, [1, 2, 0]);
    const none = scorePracticePageSubmission(choiceKey, [-1, -1, -1]);

    expect(all.ok && all.score).toBe(100);
    expect(none.ok && none.score).toBe(0);
  });

  it('選擇題：選項 index 超過該題選項數 → 視為未作答（0 分），不 crash', () => {
    const r = scorePracticePageSubmission(choiceKey, [1, 2, 3]);

    expect(r.ok && r.score).toBe(66);
    expect(r.ok && r.detail.items[2]).toEqual({ index: 2, correct: false, points: 0, maxPoints: 34, chosen: -1 });
  });

  it('答案數跟題數不一致 → 回錯誤（例如老師中途更新了練習頁）', () => {
    expect(scorePracticePageSubmission(choiceKey, [1, 2]).ok).toBe(false);
  });

  it('題型不符（選擇題卻送填空答案）→ 回錯誤', () => {
    expect(scorePracticePageSubmission(choiceKey, [1, 2, { typed: 'a', hintUses: 0 }]).ok).toBe(false);
  });

  const fillKey = buildFillBlankAnswerKey([
    { groupLabel: 'g', before: '', after: '', answer: 'Apple' },
    { groupLabel: 'g', before: '', after: '', answer: '玉山' },
    { groupLabel: 'g', before: '', after: '', answer: 'cout' },
    { groupLabel: 'g', before: '', after: '', answer: 'x' },
  ], 3);

  it('填空：每格 25 分；大小寫與前後空白不影響；看答案每次扣該格 3%；四捨五入成整數', () => {
    const r = scorePracticePageSubmission(fillKey, [
      { typed: ' apple ', hintUses: 0 }, // 25
      { typed: '玉山', hintUses: 2 }, // 25 * 0.94 = 23.5
      { typed: 'cin', hintUses: 0 }, // 0
      { typed: 'X', hintUses: 1 }, // 25 * 0.97 = 24.25
    ]);

    expect(r.ok).toBe(true);

    if (r.ok) {
      // 25 + 23.5 + 0 + 24.25 = 72.75 → 73
      expect(r.score).toBe(73);
      expect(r.detail.correctCount).toBe(3);
      expect(r.detail.items[1]).toEqual({ index: 1, correct: true, points: 23.5, maxPoints: 25, typed: '玉山', hintUses: 2 });
      expect(r.detail.items[2]).toEqual({ index: 2, correct: false, points: 0, maxPoints: 25, typed: 'cin', hintUses: 0 });
    }
  });

  it('填空：上標／全形／次方記號視為相同（n2、n^2、ｎ２ 都對 n²；H2O 對 H₂O）', () => {
    const supKey = buildFillBlankAnswerKey([
      { groupLabel: 'g', before: '', after: '', answer: 'n²' },
      { groupLabel: 'g', before: '', after: '', answer: 'n²' },
      { groupLabel: 'g', before: '', after: '', answer: 'n²' },
      { groupLabel: 'g', before: '', after: '', answer: 'H₂O' },
    ], 3);
    const r = scorePracticePageSubmission(supKey, [
      { typed: 'n2', hintUses: 0 },
      { typed: 'n^2', hintUses: 0 },
      { typed: 'ｎ３', hintUses: 0 }, // n3 ≠ n²
      { typed: 'H2O', hintUses: 0 },
    ]);

    expect(r.ok && r.score).toBe(75);
    expect(r.ok && r.detail.items.map(it => it.correct)).toEqual([true, true, false, true]);
  });

  it('填空：空字串不算答對；看答案次數多到扣超過 100% 時該格 0 分不會變負數', () => {
    const r = scorePracticePageSubmission(fillKey, [
      { typed: '', hintUses: 0 },
      { typed: '玉山', hintUses: 50 },
      { typed: 'cout', hintUses: 0 },
      { typed: 'x', hintUses: 0 },
    ]);

    expect(r.ok && r.score).toBe(50);
    expect(r.ok && r.detail.items[1]?.points).toBe(0);
  });

  it('填空：送選擇題格式的答案 → 回錯誤', () => {
    expect(scorePracticePageSubmission(fillKey, [0, 0, 0, 0]).ok).toBe(false);
  });
});

describe('resultToken', () => {
  it('每次產生不同、長度 32 的 base64url 字串', () => {
    const a = generateResultToken();
    const b = generateResultToken();

    expect(a).not.toBe(b);
    expect(a).toMatch(/^[\w-]{32}$/);
    expect(isValidResultToken(a)).toBe(true);
  });

  it('格式不符的 token 一律不合法（擋掉奇怪字元與長度）', () => {
    expect(isValidResultToken('short')).toBe(false);
    expect(isValidResultToken(`${'a'.repeat(31)}/`)).toBe(false);
    expect(isValidResultToken('a'.repeat(33))).toBe(false);
  });
});

describe('buildClassroomShareUrl', () => {
  it('用 Classroom 分享 URL，url/title 都有 encode', () => {
    const href = buildClassroomShareUrl({
      url: 'https://quizflow.example/api/p/7/r/abc?x=1&y=2',
      title: '光合作用 練習 & 成績',
    });

    expect(href.startsWith('https://classroom.google.com/share?')).toBe(true);

    const u = new URL(href);

    expect(u.searchParams.get('url')).toBe('https://quizflow.example/api/p/7/r/abc?x=1&y=2');
    expect(u.searchParams.get('title')).toBe('光合作用 練習 & 成績');
  });
});

describe('buildSubmissionResultHtml', () => {
  const base = {
    quizTitle: '<b>光合作用</b>',
    className: '301',
    studentName: '<script>alert(1)</script>',
    score: 67,
    maxScore: 100,
    createdAt: new Date('2026-11-09T06:03:00Z'),
    detail: {
      kind: 'choice' as const,
      total: 2,
      correctCount: 1,
      items: [
        { index: 0, correct: true, points: 50, maxPoints: 50, chosen: 1 },
        { index: 1, correct: false, points: 0, maxPoints: 50, chosen: 0 },
      ],
    },
  };

  it('顯示題目名稱、班級姓名、分數、台北時間的送出時間、逐題對錯，且全部跳脫', () => {
    const html = buildSubmissionResultHtml(base);

    expect(html).toContain('&lt;b&gt;光合作用&lt;/b&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('301');
    expect(html).toContain('67');
    expect(html).toContain('2026/11/09 14:03');
    expect(html).toContain('第 1 題');
    expect(html).toContain('第 2 題');
    expect(html).toContain('noindex');
  });

  it('結果頁不含 script（純唯讀頁面）', () => {
    expect(buildSubmissionResultHtml(base)).not.toMatch(/<script/i);
  });

  it('填空題顯示學生填的內容與看答案次數', () => {
    const html = buildSubmissionResultHtml({
      ...base,
      studentName: '王小明',
      detail: {
        kind: 'fillblank',
        total: 1,
        correctCount: 1,
        items: [{ index: 0, correct: true, points: 97, maxPoints: 100, typed: '玉山', hintUses: 1 }],
      },
    });

    expect(html).toContain('玉山');
    expect(html).toContain('看答案 1 次');
  });
});

describe('submissionsToCsv', () => {
  it('BOM + 中文欄位、逐題 O/X 欄、擋公式注入、台北時間', () => {
    const csv = submissionsToCsv([
      {
        className: '301',
        studentName: '=HYPERLINK("x")',
        score: 73,
        maxScore: 100,
        createdAt: new Date('2026-11-09T06:03:00Z'),
        detail: {
          kind: 'fillblank',
          total: 2,
          correctCount: 1,
          items: [
            { index: 0, correct: true, points: 47, maxPoints: 50, typed: 'a', hintUses: 1 },
            { index: 1, correct: false, points: 0, maxPoints: 50, typed: 'b', hintUses: 0 },
          ],
        },
      },
    ]);

    expect(csv.startsWith('﻿')).toBe(true);

    const lines = csv.slice(1).trim().split('\r\n');

    expect(lines[0]).toBe('班級,姓名,分數,滿分,答對題數,題數,送出時間,第1題,第2題');
    expect(lines[1]).toBe('301,"\'=HYPERLINK(""x"")",73,100,1,2,2026/11/09 14:03,O(看答案1次),X');
  });
});
