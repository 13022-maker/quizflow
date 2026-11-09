// 練習頁「確認送出」整合測試：走真實 migration（本機無 DATABASE_URL 時 src/libs/DB.ts 自動用 in-memory PGlite）、
// 真實的 POST /api/p/[id]/submit、GET /api/p/[id]/r/[token] handler 與老師端查詢。期望值全部手算，算式寫在註解。
import { describe, expect, it } from 'vitest';

import { GET as getResultPage } from '@/app/api/p/[id]/r/[token]/route';
import { POST as submit } from '@/app/api/p/[id]/submit/route';
import { buildChoiceAnswerKey, buildFillBlankAnswerKey } from '@/lib/practicePageSubmission';
import { db } from '@/libs/DB';
import { practicePageShareSchema, quizSchema } from '@/models/Schema';

import { getPracticePageSubmissions, listOwnedPracticeShares } from './practicePageStatsQuery';

const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const S3 = '33333333-3333-4333-8333-333333333333';

let ipSeq = 0;
function post(shareId: number | string, body: unknown) {
  ipSeq += 1;
  return submit(
    new Request(`https://quizflow.example/api/p/${shareId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'x-forwarded-for': `10.1.0.${ipSeq % 250}` },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: { id: String(shareId) } },
  );
}

function getResult(shareId: number, token: string) {
  return getResultPage(
    new Request(`https://quizflow.example/api/p/${shareId}/r/${token}`),
    { params: { id: String(shareId), token } },
  );
}

async function seed(ownerId = 'user_owner') {
  const [quiz] = await db.insert(quizSchema).values({ ownerId, title: '光合作用' }).returning();
  const [choice] = await db.insert(practicePageShareSchema).values({
    quizId: quiz!.id,
    ownerId,
    url: 'https://blob.example/c.html',
    questionRange: '1-3',
    answerKey: buildChoiceAnswerKey([
      { groupLabel: 'g', question: 'Q1', options: ['a', 'b', 'c', 'd'], correctIndex: 1 },
      { groupLabel: 'g', question: 'Q2', options: ['a', 'b', 'c', 'd'], correctIndex: 2 },
      { groupLabel: 'g', question: 'Q3', options: ['a', 'b'], correctIndex: 0 },
    ]),
  }).returning();
  const [fill] = await db.insert(practicePageShareSchema).values({
    quizId: quiz!.id,
    ownerId,
    url: 'https://blob.example/f.html',
    questionRange: '1-2',
    kind: 'fillblank',
    answerKey: buildFillBlankAnswerKey([
      { groupLabel: 'g', before: '', after: '', answer: 'apple' },
      { groupLabel: 'g', before: '', after: '', answer: '玉山' },
    ], 3),
  }).returning();
  const [legacy] = await db.insert(practicePageShareSchema).values({
    quizId: quiz!.id,
    ownerId,
    url: 'https://blob.example/old.html',
    questionRange: '1-3',
  }).returning();
  return { quizId: quiz!.id, choiceId: choice!.id, fillId: fill!.id, legacyId: legacy!.id };
}

describe('練習頁成績送出（submit API + 結果頁 + 老師端查詢）', () => {
  it('選擇題：server 重算分數、回傳結果頁與 Classroom 分享網址；結果頁只顯示該筆', async () => {
    const { quizId, choiceId } = await seed();

    // 答案 [1, 0, 0]：第 1 題對 33 分、第 2 題錯、第 3 題對 34 分 → 67
    // client 謊報 score: 100 也不採用（schema 不收這個欄位）
    const res = await post(choiceId, { sessionId: S1, className: '301', studentName: '王小明', answers: [1, 0, 0], score: 100 });

    expect(res.status).toBe(200);

    const data = await res.json();

    expect(data).toMatchObject({ ok: true, score: 67, maxScore: 100 });
    expect(data.resultUrl).toMatch(new RegExp(`^https://quizflow\\.example/api/p/${choiceId}/r/[\\w-]{32}$`));

    const classroom = new URL(data.classroomShareUrl);

    expect(classroom.origin).toBe('https://classroom.google.com');
    expect(classroom.pathname).toBe('/share');
    expect(classroom.searchParams.get('url')).toBe(data.resultUrl);
    expect(classroom.searchParams.get('title')).toBe('光合作用 作答結果－301 王小明');

    // 另一位學生
    const res2 = await post(choiceId, { sessionId: S2, className: '302', studentName: '<b>李</b>', answers: [1, 2, 0] });

    expect((await res2.json()).score).toBe(100);

    // 結果頁：唯讀、該筆資料、不含其他學生
    const token = data.resultUrl.split('/').pop() as string;
    const page = await getResult(choiceId, token);

    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toBe('private, no-store');
    expect(page.headers.get('content-security-policy')).toContain('default-src \'none\'');

    const html = await page.text();

    expect(html).toContain('光合作用');
    expect(html).toContain('王小明');
    expect(html).toContain('67');
    expect(html).not.toContain('李');

    // token 對上別的 share id、或亂猜的 token → 404
    expect((await getResult(choiceId + 1, token)).status).toBe(404);
    expect((await getResult(choiceId, 'a'.repeat(32))).status).toBe(404);
    expect((await getResult(choiceId, '../../etc')).status).toBe(404);

    // 老師端：送出時間舊到新
    const rows = await getPracticePageSubmissions(choiceId);

    expect(rows.map(r => [r.className, r.studentName, r.score])).toEqual([
      ['301', '王小明', 67],
      ['302', '<b>李</b>', 100],
    ]);
    expect(rows[0]!.detail.correctCount).toBe(2);

    // 擁有者驗證：別的老師看不到這份 share
    expect((await listOwnedPracticeShares('user_owner', quizId)).some(s => s.id === choiceId)).toBe(true);
    expect((await listOwnedPracticeShares('user_other', quizId)).some(s => s.id === choiceId)).toBe(false);
  });

  it('同一 session 重送：不重複寫入，回傳第一次的結果（即使第二次答案不同）', async () => {
    const { choiceId } = await seed();
    const first = await (await post(choiceId, { sessionId: S1, className: '301', studentName: '甲', answers: [0, 0, 1] })).json();
    const second = await (await post(choiceId, { sessionId: S1, className: '301', studentName: '甲', answers: [1, 2, 0] })).json();

    expect(first.score).toBe(0);
    expect(second.score).toBe(0);
    expect(second.resultUrl).toBe(first.resultUrl);
    expect(await getPracticePageSubmissions(choiceId)).toHaveLength(1);
  });

  it('填空：server 依答案表重算，看答案扣分採 client 回報次數', async () => {
    const { fillId } = await seed();
    // 每格 50 分：第 1 格 Apple 對、看 2 次 → 50 × 0.94 = 47；第 2 格錯 → 0；合計 47
    const res = await post(fillId, {
      sessionId: S3,
      className: '301',
      studentName: '王小明',
      answers: [{ typed: 'Apple', hintUses: 2 }, { typed: '雪山', hintUses: 0 }],
    });

    expect(res.status).toBe(200);
    expect((await res.json()).score).toBe(47);
  });

  it('拒絕：舊版連結沒有答案表 409、題數不符 409、題型不符 409、格式錯 400、不存在的 share 404', async () => {
    const { choiceId, fillId, legacyId } = await seed();
    const base = { sessionId: S1, className: '301', studentName: '王小明' };

    expect((await post(legacyId, { ...base, answers: [1, 2, 0] })).status).toBe(409);
    expect((await post(choiceId, { ...base, answers: [1, 2] })).status).toBe(409);
    expect((await post(fillId, { ...base, answers: [0, 1] })).status).toBe(409);
    expect((await post(choiceId, { ...base, studentName: '  ', answers: [1, 2, 0] })).status).toBe(400);
    expect((await post(choiceId, 'not json')).status).toBe(400);
    expect((await post(999999, { ...base, answers: [1] })).status).toBe(404);
    expect((await post('abc', { ...base, answers: [1] })).status).toBe(404);

    // 被拒絕的送出都不會寫入
    expect(await getPracticePageSubmissions(choiceId)).toHaveLength(0);
    expect(await getPracticePageSubmissions(legacyId)).toHaveLength(0);
  });
});
