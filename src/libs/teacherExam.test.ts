// src/libs/teacherExam.test.ts
// vitest 執行：npm run test
// 只做 smoke test — 確認 Buffer 能產出且 size > 0。
// XML 結構不在這裡驗（順序不穩定），等之後加 jszip 再做 deep assertion。

import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import {
  generateTeacherExam,
  type TeacherExamInput,
  type TeacherExamQuestion,
} from './teacherExam';

const baseInput: Omit<TeacherExamInput, 'questions'> = {
  school: '啟英高中',
  academicYear: '114',
  semester: '2',
  examPeriod: '期中',
  subject: '程式語言',
  classType: '僑生班',
  applicableClass: '僑資二甲A班',
  teacherName: '謝金洪',
  scope: 'ch4~ch6',
};

const mkQuestion = (i: number): TeacherExamQuestion => ({
  stem: `題目 ${i}：這是測試題幹`,
  options: { A: `選項A${i}`, B: `選項B${i}`, C: `選項C${i}`, D: `選項D${i}` },
});

const mkInput = (n: number): TeacherExamInput => ({
  ...baseInput,
  questions: Array.from({ length: n }, (_, i) => mkQuestion(i + 1)),
});

describe('generateTeacherExam', () => {
  it('0 題仍能產出 Buffer', async () => {
    const buf = await generateTeacherExam(mkInput(0));

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('25 題能產出 Buffer', async () => {
    const buf = await generateTeacherExam(mkInput(25));

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('30 題（標準題數）能產出 Buffer', async () => {
    const buf = await generateTeacherExam(mkInput(30));

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('35 題（超過答案欄上限）仍能產出 Buffer', async () => {
    const buf = await generateTeacherExam(mkInput(35));

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('缺必填欄位（school）應 throw', async () => {
    const bad = { ...mkInput(5) } as Partial<TeacherExamInput>;
    delete bad.school;

    await expect(generateTeacherExam(bad as TeacherExamInput)).rejects.toThrow(/school/);
  });
});
