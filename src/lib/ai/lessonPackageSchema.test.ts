import { describe, expect, it } from 'vitest';

import { formatLessonPackageErrors, lessonPackageSchema } from './lessonPackageSchema';

const validPackage = {
  quizzes: [
    {
      stage: 'pretest',
      title: '診斷測驗 - 光合作用',
      questions: [
        { type: 'mc', question: '光合作用發生在哪？', options: ['葉綠體', '粒線體', '細胞核', '液泡'], answer: 'A', explanation: '葉綠體含葉綠素' },
      ],
    },
    {
      stage: 'deepen',
      title: '深化排序 - 光合作用',
      questions: [
        { type: 'rank', question: '請依步驟排列光合作用流程', options: ['吸收陽光', '固定二氧化碳', '產生葡萄糖'], answer: ['吸收陽光', '固定二氧化碳', '產生葡萄糖'], explanation: '' },
      ],
    },
  ],
  flashcards: {
    title: '詞彙卡 - 光合作用',
    cards: [{ front: '葉綠素', back: '吸收光能的色素', example: '葉綠素讓葉子呈現綠色' }],
  },
  teacherNotes: {
    flow: '5分鐘|前測|pretest|巡堂',
    misconceptions: ['以為光合作用只在白天發生'],
    afterClass: '匯出成績給科任老師',
  },
};

describe('lessonPackageSchema', () => {
  it('合法的完整備課包可以通過驗證', () => {
    const result = lessonPackageSchema.safeParse(validPackage);

    expect(result.success).toBe(true);
  });

  it('缺少 quizzes 欄位時驗證失敗', () => {
    const { quizzes, ...rest } = validPackage;
    const result = lessonPackageSchema.safeParse(rest);

    expect(result.success).toBe(false);
  });

  it('quizzes 為空陣列時驗證失敗', () => {
    const result = lessonPackageSchema.safeParse({ ...validPackage, quizzes: [] });

    expect(result.success).toBe(false);
  });

  it('rank 題型的 answer 陣列長度跟 options 不一致時驗證失敗', () => {
    const bad = {
      ...validPackage,
      quizzes: [
        {
          title: '測驗',
          questions: [
            { type: 'rank', question: 'Q', options: ['甲', '乙', '丙'], answer: ['甲', '乙'] },
          ],
        },
      ],
    };
    const result = lessonPackageSchema.safeParse(bad);

    expect(result.success).toBe(false);
  });

  it('cloze 題型的 question 沒有 [[ ]] 標記時驗證失敗', () => {
    const bad = {
      ...validPackage,
      quizzes: [
        {
          title: '測驗',
          questions: [
            { type: 'cloze', question: '這句話沒有標記任何詞彙', answer: '忽略' },
          ],
        },
      ],
    };
    const result = lessonPackageSchema.safeParse(bad);

    expect(result.success).toBe(false);
  });

  it('cloze 題型有 [[ ]] 標記時可以通過驗證（不需要 answer/options）', () => {
    const ok = {
      ...validPackage,
      quizzes: [
        {
          title: '測驗',
          questions: [
            { type: 'cloze', question: '光合作用需要[[陽光]]。' },
          ],
        },
      ],
    };
    const result = lessonPackageSchema.safeParse(ok);

    expect(result.success).toBe(true);
  });

  it('flashcards.cards 為空陣列時驗證失敗', () => {
    const bad = { ...validPackage, flashcards: { title: '詞彙卡', cards: [] } };
    const result = lessonPackageSchema.safeParse(bad);

    expect(result.success).toBe(false);
  });

  it('type 不是允許的短碼時驗證失敗', () => {
    const bad = {
      ...validPackage,
      quizzes: [
        { title: '測驗', questions: [{ type: 'multiple_choice', question: 'Q', answer: 'A' }] },
      ],
    };
    const result = lessonPackageSchema.safeParse(bad);

    expect(result.success).toBe(false);
  });

  it('formatLessonPackageErrors 回傳可讀的 path + message 清單', () => {
    const bad = { ...validPackage, quizzes: [] };
    const result = lessonPackageSchema.safeParse(bad);

    expect(result.success).toBe(false);

    if (!result.success) {
      const errors = formatLessonPackageErrors(result.error);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toHaveProperty('path');
      expect(errors[0]).toHaveProperty('message');
    }
  });
});
