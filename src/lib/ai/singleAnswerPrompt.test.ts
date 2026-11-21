import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildLessonPrepPrompt, DEFAULT_LESSON_PREP_STAGES } from './lessonPrepPromptBuilder';
import { buildSingleAnswerRule } from './singleAnswerPrompt';

describe('buildSingleAnswerRule', () => {
  it('要求單選題恰好一個可辯護的正解，干擾項在題幹下必須明確錯誤', () => {
    const rule = buildSingleAnswerRule();

    expect(rule).toContain('【選擇題正解唯一規則】');
    expect(rule).toContain('恰好只有一個');
    expect(rule).toContain('明確錯誤');
  });

  it('否定題幹（不是／非／錯誤／不屬於／不正確）：三個干擾項都要符合正向條件，不可取用相鄰概念', () => {
    const rule = buildSingleAnswerRule();

    for (const word of ['不是', '非', '錯誤', '不屬於', '不正確']) {
      expect(rule).toContain(word);
    }

    expect(rule).toContain('相鄰概念');
    // 以實際踩過的案例（URL 組成 vs 網域名稱組成）當反例
    expect(rule).toContain('網址（URL）');
    expect(rule).toContain('網域名稱');
  });

  it('要求選項用語精確，並在輸出前逐題自我檢查每個錯誤選項', () => {
    const rule = buildSingleAnswerRule();

    expect(rule).toContain('精確');
    expect(rule).toContain('自我檢查');
  });

  it('預設要求 explanation 欄位說明每個干擾項為何錯誤，可指定其他欄位名稱', () => {
    expect(buildSingleAnswerRule()).toContain('explanation 欄位');
    expect(buildSingleAnswerRule()).toContain('每個錯誤選項為何錯');
    expect(buildSingleAnswerRule({ explanationField: 'reason' })).toContain('reason 欄位');
  });

  it('輸出格式沒有詳解欄位時（explanationField: null），不可要求 AI 多輸出欄位', () => {
    const rule = buildSingleAnswerRule({ explanationField: null });

    expect(rule).toContain('自我檢查');
    expect(rule).not.toContain('每個錯誤選項為何錯');
    expect(rule).toContain('不要輸出');
  });
});

describe('buildLessonPrepPrompt', () => {
  it('備課 prompt 包含選擇題正解唯一規則', () => {
    expect(buildLessonPrepPrompt(DEFAULT_LESSON_PREP_STAGES)).toContain('【選擇題正解唯一規則】');
  });
});

// 出題 prompt 都是寫在 route / action 內的 template string（沒有獨立 builder 可呼叫），
// 用原始碼掃描當防呆：避免之後新增／改寫出題 prompt 時漏掉這條規則
describe('所有選擇題出題 prompt 都有注入 buildSingleAnswerRule', () => {
  const root = path.resolve(__dirname, '../../..');
  const files = [
    'src/app/api/ai/generate-questions/route.ts',
    'src/app/api/ai/generate-from-file/route.ts',
    'src/app/api/ai/generate-from-url/route.ts',
    'src/app/api/ai/regenerate-question/[id]/route.ts',
    'src/app/api/ai/generate-remedial/route.ts',
    'src/app/api/ai/bloom-studio/route.ts',
    'src/actions/aiActions.ts',
  ];

  it.each(files)('%s', (file) => {
    const src = readFileSync(path.join(root, file), 'utf8');

    expect(src).toContain('from \'@/lib/ai/singleAnswerPrompt\'');
    expect(src).toMatch(/\$\{buildSingleAnswerRule\(/);
  });
});
