// 練習頁作答統計整合測試：走真實 migration（本機無 DATABASE_URL 時 src/libs/DB.ts 自動用 in-memory PGlite）、
// 真實的 POST /api/p/[id]/events handler 與真實的聚合 SQL。期望值全部手算，算式寫在註解。
import { describe, expect, it } from 'vitest';

import { POST } from '@/app/api/p/[id]/events/route';
import { db } from '@/libs/DB';
import { practicePageShareSchema, questionSchema, quizSchema } from '@/models/Schema';

import { getPracticePageLeads, getPracticePageStats, listOwnedPracticeShares } from './practicePageStatsQuery';

const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const S3 = '33333333-3333-4333-8333-333333333333';

let ipSeq = 0;
function post(shareId: number, body: unknown) {
  ipSeq += 1;
  return POST(
    new Request(`https://quizflow.example/api/p/${shareId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'x-forwarded-for': `10.0.0.${ipSeq % 250}` },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: { id: String(shareId) } },
  );
}

async function seed() {
  const [quiz] = await db.insert(quizSchema).values({ ownerId: 'user_owner', title: 'C++ 追蹤' }).returning();
  const [q1, q2] = await db.insert(questionSchema).values([
    { quizId: quiz!.id, type: 'single_choice', body: '第一題', position: 0, options: [{ id: 'a', text: '甲' }, { id: 'b', text: '乙' }, { id: 'c', text: '丙' }], correctAnswers: ['b'] },
    { quizId: quiz!.id, type: 'single_choice', body: '第二題', position: 1, options: [{ id: 'a', text: '子' }, { id: 'b', text: '丑' }, { id: 'c', text: '寅' }], correctAnswers: ['c'] },
  ]).returning();
  const [share] = await db.insert(practicePageShareSchema).values({
    quizId: quiz!.id,
    ownerId: 'user_owner',
    url: 'https://blob.example/x.html',
    questionRange: '1-2',
  }).returning();
  return { quizId: quiz!.id, shareId: share!.id, q1: q1!.id, q2: q2!.id };
}

const answer = (sessionId: string, questionIndex: number, questionId: number, chosenOption: number, isCorrect: boolean) => ({
  type: 'answer',
  sessionId,
  questionIndex,
  questionId,
  chosenOption,
  isCorrect,
  msOnQuestion: 5000,
});

describe('練習頁作答統計（事件端點 + 聚合 SQL）', () => {
  it('收事件、去重、聚合成老師統計頁要的數字', async () => {
    const { quizId, shareId, q1, q2 } = await seed();

    // S1：ep1，兩題都答完（第1題對、第2題選0錯）→ 1/2，完成
    // S2：ep1，兩題都答完（第1題選0錯、第2題選0錯）→ 0/2，完成；第1題重送一次不同答案要被忽略
    // S3：ep2，只答第1題（選2錯），未完成
    const events = [
      { type: 'session_start', sessionId: S1, utmSource: 'shorts', utmContent: 'ep1', deviceType: 'mobile' },
      answer(S1, 0, q1, 1, true),
      answer(S1, 1, q2, 0, false),
      { type: 'complete', sessionId: S1, answeredCount: 2, correctCount: 1 },
      { type: 'profile', sessionId: S1, role: 'senior_high' },
      { type: 'profile', sessionId: S1, role: 'teacher', language: 'cpp' }, // 同 session 最後一次為準
      { type: 'session_start', sessionId: S2, utmSource: 'shorts', utmContent: 'ep1', deviceType: 'desktop' },
      answer(S2, 0, q1, 0, false),
      answer(S2, 0, q1, 1, true), // 重送：忽略
      answer(S2, 1, q2, 0, false),
      { type: 'complete', sessionId: S2, answeredCount: 2, correctCount: 0 },
      { type: 'session_start', sessionId: S3, utmContent: 'ep2', deviceType: 'mobile' },
      answer(S3, 0, q1, 2, false),
    ];
    for (const ev of events) {
      const res = await post(shareId, ev);

      expect(res.status).toBe(200);
    }

    const stats = await getPracticePageStats(shareId, quizId);

    // 3 個 session、2 個完成 → 完成率 2/3
    expect(stats.sessions).toBe(3);
    expect(stats.completed).toBe(2);
    expect(stats.completionRate).toBeCloseTo(2 / 3);
    // 完成者平均答對 (1+0)/2 = 0.5，平均作答 2
    expect(stats.avgCorrect).toBe(0.5);
    expect(stats.avgAnswered).toBe(2);

    // 第2題：2 人作答 2 錯 → 100%；第1題：3 人作答（S1 對、S2 選0錯、S3 選2錯）→ 2/3
    expect(stats.questions.map(q => [q.questionIndex, q.attempts, q.wrong])).toEqual([[1, 2, 2], [0, 3, 2]]);
    expect(stats.questions[0]!.topWrongOption).toBe(0);
    expect(stats.questions[0]!.body).toBe('第二題');
    expect(stats.questions[0]!.optionTexts).toEqual(['子', '丑', '寅']);
    expect(stats.questions[1]!.distribution).toEqual([
      { option: 0, count: 1, isCorrect: false },
      { option: 1, count: 1, isCorrect: true },
      { option: 2, count: 1, isCorrect: false },
    ]);

    // ep1：2 session 2 完成；ep2：1 session 0 完成
    expect(stats.utm).toEqual([
      { utmContent: 'ep1', sessions: 2, completed: 2 },
      { utmContent: 'ep2', sessions: 1, completed: 0 },
    ]);

    // S1 最後一次 profile：teacher / cpp / examPlan 未選
    expect(stats.profile.role).toEqual([{ value: 'teacher', count: 1 }]);
    expect(stats.profile.language).toEqual([{ value: 'cpp', count: 1 }]);
    expect(stats.profile.examPlan).toEqual([{ value: null, count: 1 }]);
    expect(stats.leadCount).toBe(0);
  });

  it('email：沒勾同意拒收、同 email 同份練習頁只留一筆、存小寫', async () => {
    const { quizId, shareId } = await seed();

    expect((await post(shareId, { type: 'lead', sessionId: S1, email: 'a@b.com', consent: false })).status).toBe(400);
    expect((await post(shareId, { type: 'lead', sessionId: S1, email: 'Stu@Example.com', consent: true })).status).toBe(200);
    expect((await post(shareId, { type: 'lead', sessionId: S2, email: 'stu@example.com', consent: true })).status).toBe(200);

    const leads = await getPracticePageLeads(shareId);

    expect(leads.map(l => [l.email, l.sessionId])).toEqual([['stu@example.com', S1]]);
    expect((await getPracticePageStats(shareId, quizId)).leadCount).toBe(1);
  });

  it('不存在的分享連結 404、壞 JSON 400', async () => {
    expect((await post(99_999_999, { type: 'complete', sessionId: S1, answeredCount: 1, correctCount: 1 })).status).toBe(404);
    expect((await post(1, 'not json')).status).toBe(400);
  });

  it('listOwnedPracticeShares 只列出自己 quiz 的分享連結', async () => {
    const { quizId, shareId } = await seed();

    expect((await listOwnedPracticeShares('user_owner', quizId)).map(s => s.id)).toEqual([shareId]);
    expect(await listOwnedPracticeShares('someone_else', quizId)).toEqual([]);
  });
});
