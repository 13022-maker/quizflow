import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildFillBlankPracticePageHtml } from './exportFillBlankPracticePage';
import { buildPracticePageHtml, injectPracticePageConfig } from './exportPracticePage';

// 2026-11-11 學生在 Google Classroom 分享頁選完課程後卡在「請選取近期有作業的課程」、按鈕按不下去：
// 該課程還沒有老師建立的作業。繳交按鈕旁要先提醒「需先由老師在 Classroom 建立作業」，
// 而且已發出的舊連結（Blob 裡的舊 HTML）經 /api/p/[id] 代理時也要換上新提示。
const NEW_TIP = '需先由老師在 Classroom 建立作業';
const OLD_TIP_ONLY = '請選老師出的那份作業 → 按「繳交」</b>，老師才會收到！</div>';

const CONFIG = {
  endpoint: 'https://quizflow.example/api/p/24/events',
  signupUrl: 'https://quizflow.example/sign-up',
  submitEndpoint: 'https://quizflow.example/api/p/24/submit',
};

const FIXTURE_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '__fixtures__');
const LEGACY_MC_HTML = readFileSync(path.join(FIXTURE_DIR, 'legacy-practice-page-pr90-99.html'), 'utf8');
const LEGACY_FILLBLANK_HTML = readFileSync(path.join(FIXTURE_DIR, 'legacy-fillblank-practice-page-pr90-99.html'), 'utf8');

describe('Classroom 繳交按鈕旁提示「需先由老師在 Classroom 建立作業」', () => {
  it('新匯出的選擇題練習頁有提示', () => {
    const html = buildPracticePageHtml({
      title: 't',
      kick: 'k',
      questions: [{ id: 1, groupLabel: 'g', question: 'Q1', options: ['a', 'b'], correctIndex: 0 }],
    });

    expect(html).toContain(NEW_TIP);
  });

  it('新匯出的填空練習頁有提示', () => {
    const html = buildFillBlankPracticePageHtml({
      title: 't',
      kick: 'k',
      questions: [{ groupLabel: 'g', before: 'a ', after: '.', answer: 'b' }],
    });

    expect(html).toContain(NEW_TIP);
  });

  it('舊版選擇題連結經代理注入後換上新提示', () => {
    expect(LEGACY_MC_HTML).not.toContain(NEW_TIP);

    const out = injectPracticePageConfig(LEGACY_MC_HTML, CONFIG);

    expect(out).toContain(NEW_TIP);
    expect(out).not.toContain(OLD_TIP_ONLY);
  });

  it('舊版填空連結經代理注入後換上新提示', () => {
    expect(LEGACY_FILLBLANK_HTML).not.toContain(NEW_TIP);

    const out = injectPracticePageConfig(LEGACY_FILLBLANK_HTML, CONFIG);

    expect(out).toContain(NEW_TIP);
    expect(out).not.toContain(OLD_TIP_ONLY);
  });
});
