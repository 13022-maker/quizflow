// 19 個 unit tests:純函數,不接 DB(對齊 scoring.test.ts 風格)

import { describe, expect, it } from 'vitest';

import {
  assertCanFork,
  buildDuplicateQuizValues,
  buildForkedQuestions,
  buildNewQuizValues,
  ForkError,
  type SourceQuestion,
  type SourceQuiz,
} from './fork';

// 測試 fixture：預設一個合法的 public source quiz
const mkSource = (overrides: Partial<SourceQuiz> = {}): SourceQuiz => ({
  id: 100,
  ownerId: 'user_source',
  title: '光合作用測驗',
  description: '生物科素養題',
  visibility: 'public',
  shuffleQuestions: true,
  shuffleOptions: false,
  allowedAttempts: 3,
  showAnswers: true,
  timeLimitSeconds: 600,
  preventLeave: true,
  scoringMode: 'highest',
  attemptDecayRate: 0.9,
  quizMode: 'standard',
  category: '生物',
  gradeLevel: '高一',
  tags: ['生物', '光合作用'],
  ...overrides,
});

const mkQuestion = (overrides: Partial<SourceQuestion> = {}): SourceQuestion => ({
  type: 'single_choice',
  body: '光合作用主要發生在哪裡？',
  imageUrl: null,
  audioUrl: null,
  audioDurationSec: null,
  audioTranscript: null,
  options: [
    { id: 'a', text: '葉綠體' },
    { id: 'b', text: '粒線體' },
  ],
  correctAnswers: ['a'],
  points: 10,
  position: 1,
  aiHint: '光合作用需要光與葉綠素',
  diagramSvg: null,
  referenceAnswer: null,
  explanation: null,
  ...overrides,
});

// 由 caller 注入,避免測試依賴隨機產生器
const codes = { accessCode: 'ABCDEFGH', roomCode: 'AB12CD' };

// ─── buildNewQuizValues（9 個）──────────────────────────────────────────────

describe('buildNewQuizValues', () => {
  it('title 加「（副本）」後綴', () => {
    const source = mkSource({ title: '光合作用測驗' });
    const values = buildNewQuizValues(source, 'user_new', codes);

    expect(values.title).toBe('光合作用測驗（副本）');
  });

  it('可繼承欄位（description / category / gradeLevel / tags / 教學設定）直接拷貝', () => {
    const source = mkSource();
    const values = buildNewQuizValues(source, 'user_new', codes);

    expect(values.description).toBe(source.description);
    expect(values.category).toBe(source.category);
    expect(values.gradeLevel).toBe(source.gradeLevel);
    expect(values.tags).toEqual(source.tags);
    expect(values.quizMode).toBe(source.quizMode);
    expect(values.shuffleQuestions).toBe(source.shuffleQuestions);
    expect(values.shuffleOptions).toBe(source.shuffleOptions);
    expect(values.allowedAttempts).toBe(source.allowedAttempts);
    expect(values.showAnswers).toBe(source.showAnswers);
    expect(values.timeLimitSeconds).toBe(source.timeLimitSeconds);
    expect(values.preventLeave).toBe(source.preventLeave);
    expect(values.scoringMode).toBe(source.scoringMode);
    expect(values.attemptDecayRate).toBe(source.attemptDecayRate);
  });

  it('accessCode / roomCode 用注入的新值（不繼承 source）', () => {
    const values = buildNewQuizValues(mkSource(), 'user_new', codes);

    expect(values.accessCode).toBe('ABCDEFGH');
    expect(values.roomCode).toBe('AB12CD');
  });

  it('status 強制 draft（新 quiz 不直接發佈）', () => {
    const values = buildNewQuizValues(mkSource(), 'user_new', codes);

    expect(values.status).toBe('draft');
  });

  it('visibility 強制 private（不論 source 是 public 或 unlisted）', () => {
    const fromPublic = buildNewQuizValues(mkSource({ visibility: 'public' }), 'user_new', codes);
    const fromUnlisted = buildNewQuizValues(mkSource({ visibility: 'unlisted' }), 'user_new', codes);

    expect(fromPublic.visibility).toBe('private');
    expect(fromUnlisted.visibility).toBe('private');
  });

  it('slug / publishedAt / expiresAt 全清空,forkCount 重置為 0', () => {
    const values = buildNewQuizValues(mkSource(), 'user_new', codes);

    expect(values.slug).toBeNull();
    expect(values.publishedAt).toBeNull();
    expect(values.expiresAt).toBeNull();
    expect(values.forkCount).toBe(0);
  });

  it('forkedFromId 指向 source.id（lineage 紀錄）', () => {
    const source = mkSource({ id: 999 });
    const values = buildNewQuizValues(source, 'user_new', codes);

    expect(values.forkedFromId).toBe(999);
  });

  it('publisherId / isbn / chapter / bookTitle 不繼承（防書商徽章污染）', () => {
    const values = buildNewQuizValues(mkSource(), 'user_new', codes);

    expect(values.publisherId).toBeNull();
    expect(values.isbn).toBeNull();
    expect(values.chapter).toBeNull();
    expect(values.bookTitle).toBeNull();
  });

  it('ownerId 設為新 actor', () => {
    const values = buildNewQuizValues(mkSource(), 'user_new', codes);

    expect(values.ownerId).toBe('user_new');
  });
});

// ─── buildDuplicateQuizValues（同帳號複製給其他班級用,8 個）─────────────────
// 跟 buildNewQuizValues 的差異:owner 不變、標題後綴不同、不留 marketplace 血緣

describe('buildDuplicateQuizValues', () => {
  it('title 加「（複製）」後綴（與 fork 的「（副本）」區分）', () => {
    const source = mkSource({ title: '光合作用測驗' });
    const values = buildDuplicateQuizValues(source, codes);

    expect(values.title).toBe('光合作用測驗（複製）');
  });

  it('ownerId 維持跟 source 相同（同帳號複製,不是 fork 給別人）', () => {
    const source = mkSource({ ownerId: 'user_source' });
    const values = buildDuplicateQuizValues(source, codes);

    expect(values.ownerId).toBe('user_source');
  });

  it('accessCode / roomCode 用注入的新值（不沿用來源,避免 unique 衝突）', () => {
    const values = buildDuplicateQuizValues(mkSource(), codes);

    expect(values.accessCode).toBe('ABCDEFGH');
    expect(values.roomCode).toBe('AB12CD');
  });

  it('status 強制 draft（複製後先草稿,讓老師檢查再發佈）', () => {
    const values = buildDuplicateQuizValues(mkSource(), codes);

    expect(values.status).toBe('draft');
  });

  it('visibility 強制 private（不論 source 是否已公開上架市集）', () => {
    const values = buildDuplicateQuizValues(mkSource({ visibility: 'public' }), codes);

    expect(values.visibility).toBe('private');
  });

  it('forkedFromId 為 null（不是 marketplace 血緣,不計入 forkCount 統計）', () => {
    const values = buildDuplicateQuizValues(mkSource({ id: 999 }), codes);

    expect(values.forkedFromId).toBeNull();
  });

  it('slug / publishedAt / expiresAt 全清空,forkCount 重置為 0', () => {
    const values = buildDuplicateQuizValues(mkSource(), codes);

    expect(values.slug).toBeNull();
    expect(values.publishedAt).toBeNull();
    expect(values.expiresAt).toBeNull();
    expect(values.forkCount).toBe(0);
  });

  it('可繼承欄位（description / category / gradeLevel / tags / 教學設定）直接拷貝', () => {
    const source = mkSource();
    const values = buildDuplicateQuizValues(source, codes);

    expect(values.description).toBe(source.description);
    expect(values.category).toBe(source.category);
    expect(values.gradeLevel).toBe(source.gradeLevel);
    expect(values.tags).toEqual(source.tags);
    expect(values.quizMode).toBe(source.quizMode);
    expect(values.shuffleQuestions).toBe(source.shuffleQuestions);
    expect(values.shuffleOptions).toBe(source.shuffleOptions);
    expect(values.allowedAttempts).toBe(source.allowedAttempts);
    expect(values.showAnswers).toBe(source.showAnswers);
    expect(values.timeLimitSeconds).toBe(source.timeLimitSeconds);
    expect(values.preventLeave).toBe(source.preventLeave);
    expect(values.scoringMode).toBe(source.scoringMode);
    expect(values.attemptDecayRate).toBe(source.attemptDecayRate);
  });
});

// ─── buildForkedQuestions（4 個）────────────────────────────────────────────

describe('buildForkedQuestions', () => {
  it('單題的 type / body / options / correctAnswers / points / position 直接拷', () => {
    const q = mkQuestion();
    const [out] = buildForkedQuestions([q], 555);

    expect(out!.type).toBe(q.type);
    expect(out!.body).toBe(q.body);
    expect(out!.options).toEqual(q.options);
    expect(out!.correctAnswers).toEqual(q.correctAnswers);
    expect(out!.points).toBe(q.points);
    expect(out!.position).toBe(q.position);
  });

  it('aiHint 直接拷（修現況 copyQuizFromMarketplace 漏拷的 bug）', () => {
    const q = mkQuestion({ aiHint: '提示：看光線方向' });
    const [out] = buildForkedQuestions([q], 555);

    expect(out!.aiHint).toBe('提示：看光線方向');
  });

  it('每題的 quizId 改成新 quiz id', () => {
    const out = buildForkedQuestions([mkQuestion(), mkQuestion()], 777);

    expect(out[0]!.quizId).toBe(777);
    expect(out[1]!.quizId).toBe(777);
  });

  it('多題保持原 position 順序（不重新編號）', () => {
    const qs = [
      mkQuestion({ position: 3 }),
      mkQuestion({ position: 1 }),
      mkQuestion({ position: 2 }),
    ];
    const out = buildForkedQuestions(qs, 1);

    expect(out.map(q => q.position)).toEqual([3, 1, 2]);
  });

  it('diagramSvg / referenceAnswer / explanation 直接拷（修現況漏拷的 bug）', () => {
    const q = mkQuestion({
      diagramSvg: '<svg>光合作用示意圖</svg>',
      referenceAnswer: '光合作用發生在葉綠體',
      explanation: '因為葉綠體含有葉綠素，可以吸收光能',
    });
    const [out] = buildForkedQuestions([q], 555);

    expect(out!.diagramSvg).toBe('<svg>光合作用示意圖</svg>');
    expect(out!.referenceAnswer).toBe('光合作用發生在葉綠體');
    expect(out!.explanation).toBe('因為葉綠體含有葉綠素，可以吸收光能');
  });
});

// ─── assertCanFork（6 個）───────────────────────────────────────────────────

describe('assertCanFork', () => {
  it('public source + Pro 通過', () => {
    expect(() =>
      assertCanFork(mkSource({ visibility: 'public' }), 'user_new', true),
    ).not.toThrow();
  });

  it('unlisted source + Pro 通過', () => {
    expect(() =>
      assertCanFork(mkSource({ visibility: 'unlisted' }), 'user_new', true),
    ).not.toThrow();
  });

  it('private source 拋 ForkError code=visibility', () => {
    try {
      assertCanFork(mkSource({ visibility: 'private' }), 'user_new', true);

      expect.fail('應該拋出 ForkError');
    } catch (e) {
      expect(e).toBeInstanceOf(ForkError);
      expect((e as ForkError).code).toBe('visibility');
    }
  });

  it('self-fork（actor 等於 source.ownerId）拋 ForkError code=self-fork', () => {
    try {
      assertCanFork(mkSource({ ownerId: 'user_x' }), 'user_x', true);

      expect.fail('應該拋出 ForkError');
    } catch (e) {
      expect(e).toBeInstanceOf(ForkError);
      expect((e as ForkError).code).toBe('self-fork');
    }
  });

  it('非 Pro 拋 ForkError code=plan', () => {
    try {
      assertCanFork(mkSource(), 'user_new', false);

      expect.fail('應該拋出 ForkError');
    } catch (e) {
      expect(e).toBeInstanceOf(ForkError);
      expect((e as ForkError).code).toBe('plan');
    }
  });

  it('source 不存在（null）拋 ForkError code=not-found', () => {
    try {
      assertCanFork(null, 'user_new', true);

      expect.fail('應該拋出 ForkError');
    } catch (e) {
      expect(e).toBeInstanceOf(ForkError);
      expect((e as ForkError).code).toBe('not-found');
    }
  });
});
