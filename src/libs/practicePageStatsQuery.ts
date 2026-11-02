/**
 * 練習頁作答統計的 server 端 SQL 聚合（老師統計頁、名單 CSV 使用）。
 * 呼叫端必須先驗證 shareId 屬於目前登入的老師，這裡不做權限檢查。
 *
 * 去重規則：
 *   - 每個 session 每題只算第一次作答（練習頁本來就鎖定第一次作答，重送的事件忽略）
 *   - 自我回報取該 session 最後一次送出的組合
 */
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';

import { buildQuestionStats, type QuestionStat } from '@/lib/practicePageStats';
import { db } from '@/libs/DB';
import {
  practicePageEventSchema as e,
  practicePageLeadSchema,
  practicePageShareSchema,
  questionSchema,
  quizSchema,
} from '@/models/Schema';

export type PracticePageStats = {
  sessions: number;
  completed: number;
  completionRate: number;
  avgCorrect: number | null; // 完成者平均答對題數
  avgAnswered: number | null; // 完成者平均作答題數（= 題數）
  questions: (QuestionStat & { body: string | null; optionTexts: string[] })[];
  utm: { utmContent: string | null; sessions: number; completed: number }[];
  profile: {
    role: { value: string | null; count: number }[];
    language: { value: string | null; count: number }[];
    examPlan: { value: string | null; count: number }[];
  };
  leadCount: number;
};

export async function getPracticePageStats(shareId: number, quizId: number): Promise<PracticePageStats> {
  const byShare = eq(e.shareId, shareId);

  const [sessionRow] = await db
    .select({ n: sql<number>`count(distinct ${e.sessionId})::int` })
    .from(e)
    .where(byShare);

  const completeSub = db
    .selectDistinctOn([e.sessionId], {
      sessionId: e.sessionId,
      correct: sql<number>`(${e.payload}->>'correctCount')::int`.as('correct'),
      answered: sql<number>`(${e.payload}->>'answeredCount')::int`.as('answered'),
    })
    .from(e)
    .where(and(byShare, eq(e.type, 'complete')))
    .orderBy(e.sessionId, asc(e.createdAt))
    .as('cs');
  const [completeRow] = await db
    .select({
      n: sql<number>`count(*)::int`,
      avgCorrect: sql<number | null>`avg(${completeSub.correct})::float8`,
      avgAnswered: sql<number | null>`avg(${completeSub.answered})::float8`,
    })
    .from(completeSub);

  const firstAnswers = db
    .selectDistinctOn([e.sessionId, e.questionIndex], {
      questionIndex: e.questionIndex,
      questionId: e.questionId,
      chosen: sql<number>`(${e.payload}->>'chosenOption')::int`.as('chosen'),
      isCorrect: sql<boolean>`(${e.payload}->>'isCorrect')::boolean`.as('is_correct'),
    })
    .from(e)
    .where(and(byShare, eq(e.type, 'answer')))
    .orderBy(e.sessionId, e.questionIndex, asc(e.createdAt))
    .as('fa');
  const answerRows = await db
    .select({
      questionIndex: firstAnswers.questionIndex,
      questionId: sql<number | null>`max(${firstAnswers.questionId})`,
      chosenOption: firstAnswers.chosen,
      isCorrect: firstAnswers.isCorrect,
      count: sql<number>`count(*)::int`,
    })
    .from(firstAnswers)
    .groupBy(firstAnswers.questionIndex, firstAnswers.chosen, firstAnswers.isCorrect);

  const questionStats = buildQuestionStats(
    answerRows
      .filter(r => r.questionIndex !== null)
      .map(r => ({
        questionIndex: r.questionIndex as number,
        questionId: r.questionId === null ? null : Number(r.questionId),
        chosenOption: r.chosenOption,
        isCorrect: r.isCorrect,
        count: r.count,
      })),
  );

  // 題目文字：用事件帶回來的 question.id 對回目前 DB（限定同一份 quiz，題目被刪就只顯示題號）
  const ids = questionStats.map(q => q.questionId).filter((id): id is number => id !== null);
  const questionRows = ids.length > 0
    ? await db
      .select({ id: questionSchema.id, body: questionSchema.body, options: questionSchema.options })
      .from(questionSchema)
      .where(and(eq(questionSchema.quizId, quizId), inArray(questionSchema.id, ids)))
    : [];
  const questionById = new Map(questionRows.map(q => [q.id, q]));

  const startSub = db
    .selectDistinctOn([e.sessionId], {
      sessionId: e.sessionId,
      utmContent: sql<string | null>`${e.payload}->>'utmContent'`.as('utm_content'),
    })
    .from(e)
    .where(and(byShare, eq(e.type, 'session_start')))
    .orderBy(e.sessionId, asc(e.createdAt))
    .as('st');
  const doneSub = db
    .selectDistinct({ doneSessionId: sql<string>`${e.sessionId}`.as('done_session_id') })
    .from(e)
    .where(and(byShare, eq(e.type, 'complete')))
    .as('dn');
  const sessionsCount = sql<number>`count(*)::int`;
  const utmRows = await db
    .select({
      utmContent: startSub.utmContent,
      sessions: sessionsCount,
      completed: sql<number>`count(${doneSub.doneSessionId})::int`,
    })
    .from(startSub)
    .leftJoin(doneSub, eq(startSub.sessionId, doneSub.doneSessionId))
    .groupBy(startSub.utmContent)
    .orderBy(desc(sessionsCount));

  const profileSub = db
    .selectDistinctOn([e.sessionId], {
      role: sql<string | null>`${e.payload}->>'role'`.as('role'),
      language: sql<string | null>`${e.payload}->>'language'`.as('language'),
      examPlan: sql<string | null>`${e.payload}->>'examPlan'`.as('exam_plan'),
    })
    .from(e)
    .where(and(byShare, eq(e.type, 'profile')))
    .orderBy(e.sessionId, desc(e.createdAt))
    .as('pf');
  const groupProfile = async (column: typeof profileSub.role) => {
    const n = sql<number>`count(*)::int`;
    return db.select({ value: column, count: n }).from(profileSub).groupBy(column).orderBy(desc(n));
  };
  const [role, language, examPlan] = await Promise.all([
    groupProfile(profileSub.role),
    groupProfile(profileSub.language),
    groupProfile(profileSub.examPlan),
  ]);

  const [leadRow] = await db
    .select({ n: count() })
    .from(practicePageLeadSchema)
    .where(eq(practicePageLeadSchema.shareId, shareId));

  const sessions = sessionRow?.n ?? 0;
  const completed = completeRow?.n ?? 0;

  return {
    sessions,
    completed,
    completionRate: sessions > 0 ? completed / sessions : 0,
    avgCorrect: completeRow?.avgCorrect ?? null,
    avgAnswered: completeRow?.avgAnswered ?? null,
    questions: questionStats.map((q) => {
      const row = q.questionId !== null ? questionById.get(q.questionId) : undefined;
      return {
        ...q,
        body: row?.body ?? null,
        optionTexts: row?.options?.map(o => o.text) ?? [],
      };
    }),
    utm: utmRows,
    profile: { role, language, examPlan },
    leadCount: leadRow?.n ?? 0,
  };
}

export async function getPracticePageLeads(shareId: number) {
  return db
    .select({
      email: practicePageLeadSchema.email,
      consentAt: practicePageLeadSchema.consentAt,
      sessionId: practicePageLeadSchema.sessionId,
      shareId: practicePageLeadSchema.shareId,
    })
    .from(practicePageLeadSchema)
    .where(eq(practicePageLeadSchema.shareId, shareId))
    .orderBy(asc(practicePageLeadSchema.createdAt));
}

// 列出老師在某份 quiz 底下的所有分享連結（統計頁切換用），同時驗證 quiz 屬於該老師
export async function listOwnedPracticeShares(userId: string, quizId: number) {
  return db
    .select({
      id: practicePageShareSchema.id,
      questionRange: practicePageShareSchema.questionRange,
      createdAt: practicePageShareSchema.createdAt,
    })
    .from(practicePageShareSchema)
    .innerJoin(quizSchema, eq(quizSchema.id, practicePageShareSchema.quizId))
    .where(and(
      eq(practicePageShareSchema.quizId, quizId),
      eq(practicePageShareSchema.ownerId, userId),
      eq(quizSchema.ownerId, userId),
    ))
    .orderBy(desc(practicePageShareSchema.createdAt));
}
