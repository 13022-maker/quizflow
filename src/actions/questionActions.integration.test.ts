// questionActions IDOR 整合測試：真實 server action + in-memory PGlite（無 DATABASE_URL 時自動使用）。
// 情境：攻擊者用「自己的 quizId」通過所有權檢查，卻帶「別人的 question id」想改／刪／重排。
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/libs/DB';
import { questionSchema, quizSchema } from '@/models/Schema';

import { deleteQuestion, reorderQuestions, updateQuestion } from './questionActions';

const ATTACKER = 'user_idor_attacker';
const VICTIM = 'user_idor_victim';

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: ATTACKER }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

async function seed() {
  const [attackerQuiz] = await db.insert(quizSchema).values({ ownerId: ATTACKER, title: '攻擊者測驗' }).returning();
  const [victimQuiz] = await db.insert(quizSchema).values({ ownerId: VICTIM, title: '受害者測驗' }).returning();
  const [ownQ] = await db.insert(questionSchema).values({
    quizId: attackerQuiz!.id,
    type: 'single_choice',
    body: '自己的題目',
    options: [{ id: 'a', text: '甲' }, { id: 'b', text: '乙' }],
    correctAnswers: ['a'],
    position: 1,
  }).returning();
  const [victimQ] = await db.insert(questionSchema).values({
    quizId: victimQuiz!.id,
    type: 'single_choice',
    body: '受害者原始題目',
    options: [{ id: 'a', text: '甲' }, { id: 'b', text: '乙' }],
    correctAnswers: ['a'],
    position: 7,
  }).returning();
  return { attackerQuizId: attackerQuiz!.id, ownQId: ownQ!.id, victimQId: victimQ!.id };
}

async function getQuestion(id: number) {
  const [row] = await db.select().from(questionSchema).where(eq(questionSchema.id, id));
  return row;
}

describe('questionActions IDOR 防護', () => {
  it('updateQuestion 不能改到別的 quiz 的題目', async () => {
    const { attackerQuizId, victimQId } = await seed();

    await expect(updateQuestion(victimQId, attackerQuizId, {
      type: 'single_choice',
      body: '被竄改',
      options: [{ id: 'a', text: '甲' }, { id: 'b', text: '乙' }],
      correctAnswers: ['b'],
      points: 1,
    })).rejects.toThrow();

    const row = await getQuestion(victimQId);

    expect(row?.body).toBe('受害者原始題目');
    expect(row?.correctAnswers).toEqual(['a']);
  });

  it('deleteQuestion 不能刪到別的 quiz 的題目', async () => {
    const { attackerQuizId, victimQId } = await seed();

    await expect(deleteQuestion(victimQId, attackerQuizId)).rejects.toThrow();

    expect(await getQuestion(victimQId)).toBeDefined();
  });

  it('reorderQuestions 不能改到別的 quiz 的題目 position，也不會只改一半', async () => {
    const { attackerQuizId, ownQId, victimQId } = await seed();

    await expect(reorderQuestions(attackerQuizId, [victimQId, ownQId])).rejects.toThrow();

    expect((await getQuestion(victimQId))?.position).toBe(7);
    expect((await getQuestion(ownQId))?.position).toBe(1);
  });

  it('正常情況：自己 quiz 的題目可以更新、重排、刪除', async () => {
    const { attackerQuizId, ownQId } = await seed();

    await updateQuestion(ownQId, attackerQuizId, {
      type: 'single_choice',
      body: '更新後',
      options: [{ id: 'a', text: '甲' }, { id: 'b', text: '乙' }],
      correctAnswers: ['b'],
      points: 2,
    });

    expect((await getQuestion(ownQId))?.body).toBe('更新後');

    await reorderQuestions(attackerQuizId, [ownQId]);

    expect((await getQuestion(ownQId))?.position).toBe(1);

    await deleteQuestion(ownQId, attackerQuizId);

    expect(await getQuestion(ownQId)).toBeUndefined();
  });
});
