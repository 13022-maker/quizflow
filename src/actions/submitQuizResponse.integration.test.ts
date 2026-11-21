// 學生送出測驗（submitQuizResponse Server Action）整合測試：
// 本機無 DATABASE_URL 時 src/libs/DB.ts 自動用 in-memory PGlite，走真實 migration。
// 目的：確認送出路徑在各種邊界資料下「回傳結果或 { error }」而不是 throw——
// production 上 Server Action throw 會被 Next.js 遮罩成
// "An error occurred in the Server Components render..."（digest），學生只看到整頁錯誤。
// 期望值全部手算，算式寫在註解。
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/libs/DB';
import { answerSchema, questionSchema, quizSchema, responseSchema, userTrialSchema } from '@/models/Schema';

import { submitQuizResponse } from './responseActions';

let ownerSeq = 0;
function nextOwner() {
  ownerSeq += 1;
  return `user_submit_test_${ownerSeq}`;
}

async function seedQuiz(ownerId: string) {
  const [quiz] = await db.insert(quizSchema).values({ ownerId, title: '送出測試' }).returning();
  return quiz!;
}

describe('submitQuizResponse 邊界資料', () => {
  it('不存在的 quizId 回傳 { error }，不 throw', async () => {
    const res = await submitQuizResponse({ quizId: 999999, answers: { 1: 'a' } });

    expect(res).toEqual({ error: '找不到題目，請重新整理頁面後再試一次' });
  });

  it('DB 層 throw（quizId 超出 int4 範圍）時回傳 { error } 並留不含個資的結構化 log', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // 2^31 = 2147483648 超出 Postgres integer 上限 2147483647，zod 的 int().positive() 擋不到
    const res = await submitQuizResponse({
      quizId: 2147483648,
      studentName: '王小明',
      studentEmail: 'student@example.com',
      answers: { 1: 'a' },
    });

    expect(res).toEqual({ error: '提交失敗，請稍候再按一次送出（作答內容仍保留在畫面上）' });
    expect(spy).toHaveBeenCalledTimes(1);

    const logged = spy.mock.calls[0]!.join(' ');

    expect(logged).toContain('[quiz-submit]');
    expect(logged).toContain('"quizId":2147483648');
    expect(logged).not.toContain('王小明');
    expect(logged).not.toContain('student@example.com');

    spy.mockRestore();
  });

  it('正解為 null、學生漏答、多送不存在題號與克漏字提示 key 都能正常計分', async () => {
    const quiz = await seedQuiz(nextOwner());
    const [q1, q2, q3] = await db.insert(questionSchema).values([
      // 單選，正解 a，學生答 a → 2 分
      { quizId: quiz.id, type: 'single_choice', body: 'Q1', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctAnswers: ['a'], points: 2, position: 0 },
      // 單選，老師沒設正解（correctAnswers = null）→ 算進分母 3、得 0
      { quizId: quiz.id, type: 'single_choice', body: 'Q2', options: [{ id: 'a', text: 'A' }], correctAnswers: null, points: 3, position: 1 },
      // 是非題，學生沒作答 → 算進分母 5、得 0
      { quizId: quiz.id, type: 'true_false', body: 'Q3', correctAnswers: ['tf-true'], points: 5, position: 2 },
    ]).returning();

    const res = await submitQuizResponse({
      quizId: quiz.id,
      studentName: '測試學生',
      answers: {
        [String(q1!.id)]: 'a',
        [String(q2!.id)]: 'a',
        99999999: 'x', // 不存在的題號（例如老師在學生作答中刪題）
        [`${q3!.id}__hints`]: ['0'], // 非 cloze 題夾帶的提示合成 key
      },
    });

    // 總分 = 2 + 0 + 0 = 2；分母 = 2 + 3 + 5 = 10
    expect(res).toMatchObject({ score: 2, totalPoints: 10 });

    if (!('responseId' in res)) {
      throw new Error('預期成功');
    }

    // 只寫入有作答且存在的題目：q1、q2 共 2 筆
    const rows = await db.select().from(answerSchema).where(eq(answerSchema.responseId, res.responseId));

    expect(rows).toHaveLength(2);
  });

  it('同一位老師（尚無試用紀錄）的多名學生同時送出，全部成功', async () => {
    // 模擬下課鐘響全班同時按送出：每次送出都會呼叫 isUserProOrAbove(quiz.ownerId)
    // → ensureTrialRecord；老師若還沒有 user_trial 紀錄，並行請求會同時「查無 → INSERT」
    const ownerId = nextOwner();
    const quiz = await seedQuiz(ownerId);
    const [q1] = await db.insert(questionSchema).values({
      quizId: quiz.id,
      type: 'single_choice',
      body: 'Q1',
      options: [{ id: 'a', text: 'A' }],
      correctAnswers: ['a'],
      points: 1,
      position: 0,
    }).returning();

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => submitQuizResponse({
        quizId: quiz.id,
        studentName: `學生${i + 1}`,
        answers: { [String(q1!.id)]: 'a' },
      })),
    );

    const rejected = results.filter(r => r.status === 'rejected');

    expect(rejected).toHaveLength(0);

    // 5 名學生 → 5 筆 response
    const responses = await db.select().from(responseSchema).where(eq(responseSchema.quizId, quiz.id));

    expect(responses).toHaveLength(5);

    // 試用紀錄只會有 1 筆
    const trials = await db.select().from(userTrialSchema).where(eq(userTrialSchema.clerkUserId, ownerId));

    expect(trials).toHaveLength(1);
  });
});
