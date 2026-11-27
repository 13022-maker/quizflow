import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getLearnPage, getLearnPath, LEARN_SUBJECT_NAMES, learnPages } from './index';

// 內容格式守門：新增 JSON 時若格式不對，test 直接紅燈
describe('learn 內容頁格式', () => {
  it('pages/ 底下每個 JSON 都有註冊進 learnPages', () => {
    const files = readdirSync(join(__dirname, 'pages')).filter(f => f.endsWith('.json'));

    expect(files.length).toBe(learnPages.length);

    for (const p of learnPages) {
      expect(files).toContain(`${p.subject}--${p.topic}.json`);
    }
  });

  it('subject + topic 不重複', () => {
    const keys = learnPages.map(p => `${p.subject}/${p.topic}`);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(learnPages.map(p => [getLearnPath(p), p] as const))('%s 格式正確', (_path, p) => {
    expect(Object.keys(LEARN_SUBJECT_NAMES)).toContain(p.subject);
    expect(p.topic).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(p.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.title.length).toBeGreaterThan(0);
    expect(p.description.length).toBeGreaterThanOrEqual(50);
    expect(p.description.length).toBeLessThanOrEqual(160);
    expect(p.keywords.length).toBeGreaterThanOrEqual(3);
    expect(p.intro.length).toBeGreaterThanOrEqual(150);
    expect(p.intro.length).toBeLessThanOrEqual(250);
    expect(p.questions).toHaveLength(10);

    for (const q of p.questions) {
      expect(q.question.trim().length).toBeGreaterThan(0);
      expect(q.options).toHaveLength(4);
      expect(new Set(q.options).size).toBe(4);
      expect(Number.isInteger(q.answer)).toBe(true);
      expect(q.answer).toBeGreaterThanOrEqual(0);
      expect(q.answer).toBeLessThan(q.options.length);
      expect(q.explanation.trim().length).toBeGreaterThan(0);
      expect([1, 2, 3, 4, 5]).toContain(q.difficulty);
    }
  });

  it('getLearnPage 找得到既有頁、找不到回 undefined', () => {
    expect(getLearnPage('math', 'linear-equation-one-variable')?.unit).toBe('一元一次方程式');
    expect(getLearnPage('math', 'no-such-topic')).toBeUndefined();
  });
});
