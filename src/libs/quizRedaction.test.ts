import type { InferSelectModel } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { questionSchema } from '@/models/Schema';

import { answerKeyFor, mergeAnswerKey, redactQuestionForTaker, shouldRedactAnswers } from './quizRedaction';

type Question = InferSelectModel<typeof questionSchema>;

function makeQuestion(overrides: Partial<Question>): Question {
  return {
    id: 1,
    quizId: 1,
    type: 'single_choice',
    body: '題目',
    imageUrl: null,
    diagramSvg: null,
    audioUrl: null,
    audioDurationSec: null,
    audioTranscript: null,
    options: [{ id: 'a', text: '甲' }, { id: 'b', text: '乙' }],
    correctAnswers: ['a'],
    referenceAnswer: null,
    explanation: null,
    points: 1,
    position: 1,
    aiHint: null,
    updatedAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('shouldRedactAnswers', () => {
  it('考試模式一律遮蔽', () => {
    expect(shouldRedactAnswers({ preventLeave: true, showAnswers: true })).toBe(true);
  });

  it('老師關閉顯示解答時遮蔽', () => {
    expect(shouldRedactAnswers({ preventLeave: false, showAnswers: false })).toBe(true);
  });

  it('練習模式且顯示解答時不遮蔽', () => {
    expect(shouldRedactAnswers({ preventLeave: false, showAnswers: true })).toBe(false);
  });
});

describe('redactQuestionForTaker', () => {
  it('拿掉所有答案相關欄位', () => {
    const q = makeQuestion({
      correctAnswers: ['a'],
      referenceAnswer: '要點',
      explanation: '因為甲',
      aiHint: '想想甲',
      audioTranscript: '逐字稿',
    });
    const r = redactQuestionForTaker(q);

    expect(r.correctAnswers).toBeNull();
    expect(r.referenceAnswer).toBeNull();
    expect(r.explanation).toBeNull();
    expect(r.aiHint).toBeNull();
    expect(r.audioTranscript).toBeNull();
    expect(r.body).toBe('題目');
  });

  it('克漏字 body 裡的答案被換掉，但空格數不變', () => {
    const q = makeQuestion({ type: 'cloze', body: '光合作用需要[[陽光]]和[[水]]。', correctAnswers: ['陽光', '水'] });
    const r = redactQuestionForTaker(q);

    expect(r.body).toBe('光合作用需要[[＿]]和[[＿]]。');
    expect(JSON.stringify(r)).not.toContain('陽光');
  });

  it('排序題的 options 不再是正確順序', () => {
    const options = [{ id: '1', text: '一' }, { id: '2', text: '二' }, { id: '3', text: '三' }];
    const q = makeQuestion({ type: 'ranking', options, correctAnswers: ['1', '2', '3'] });
    // random 永遠回 0：Fisher-Yates 每輪都跟 index 0 交換 → [1,2,3] → [3,1,2]... 手算：
    // i=2 j=0 → [3,2,1]；i=1 j=0 → [2,3,1]
    const r = redactQuestionForTaker(q, () => 0);

    expect(r.options?.map(o => o.id)).toEqual(['2', '3', '1']);
  });
});

describe('mergeAnswerKey', () => {
  it('交卷後合併回原始答案與克漏字 body，保留學生看到的選項順序', () => {
    const original = makeQuestion({ id: 9, type: 'cloze', body: 'A[[B]]C', correctAnswers: ['B'], explanation: '解析' });
    const redacted = { ...redactQuestionForTaker(original), options: [{ id: 'x', text: 'x' }] };
    const [merged] = mergeAnswerKey([redacted], [answerKeyFor(original)]);

    expect(merged?.body).toBe('A[[B]]C');
    expect(merged?.correctAnswers).toEqual(['B']);
    expect(merged?.explanation).toBe('解析');
    expect(merged?.options).toEqual([{ id: 'x', text: 'x' }]);
  });
});
