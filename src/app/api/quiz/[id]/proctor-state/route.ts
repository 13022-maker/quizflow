// 老師監考牆資料（Clerk auth，只有 quiz owner 可呼叫）
// 回傳：所有 response row（作答中 / 已提交）+ 聚合統計供儀表板用
import { auth } from '@clerk/nextjs/server';
import { desc, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import {
  answerSchema,
  questionSchema,
  quizSchema,
  responseSchema,
} from '@/models/Schema';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const quizId = Number(params.id);
  if (!Number.isFinite(quizId) || quizId <= 0) {
    return NextResponse.json({ error: 'Bad quizId' }, { status: 400 });
  }

  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  // 驗 quiz ownership
  const [quiz] = await db
    .select({ id: quizSchema.id, title: quizSchema.title, ownerId: quizSchema.ownerId })
    .from(quizSchema)
    .where(eq(quizSchema.id, quizId))
    .limit(1);
  if (!quiz) {
    return NextResponse.json({ error: '找不到測驗' }, { status: 404 });
  }
  if (quiz.ownerId !== orgId) {
    return NextResponse.json({ error: '無權限' }, { status: 403 });
  }

  // 所有 response row（attempt-based 新流程 + 舊 submitted row）
  // 只取 attempt-flow 的（studentToken 非 null），舊匿名 submit 的不顯示在監考牆
  const responses = await db
    .select({
      id: responseSchema.id,
      studentName: responseSchema.studentName,
      studentToken: responseSchema.studentToken,
      status: responseSchema.status,
      lastAnsweredQuestionIndex: responseSchema.lastAnsweredQuestionIndex,
      leaveCount: responseSchema.leaveCount,
      startedAt: responseSchema.startedAt,
      submittedAt: responseSchema.submittedAt,
      score: responseSchema.score,
      totalPoints: responseSchema.totalPoints,
    })
    .from(responseSchema)
    .where(eq(responseSchema.quizId, quizId))
    .orderBy(desc(responseSchema.startedAt));

  // 題目清單（計算題數、難題排序用）
  const questions = await db
    .select({
      id: questionSchema.id,
      body: questionSchema.body,
      type: questionSchema.type,
      position: questionSchema.position,
    })
    .from(questionSchema)
    .where(eq(questionSchema.quizId, quizId))
    .orderBy(questionSchema.position);

  const totalQuestions = questions.length;

  // 每題即時答對率（僅計 attempt-flow 回報的作答）
  const perQuestionStats: Array<{
    questionId: number;
    position: number;
    body: string;
    type: string;
    totalAnswered: number;
    totalCorrect: number;
    correctRate: number | null; // null = 尚無作答
  }> = [];

  if (totalQuestions > 0 && responses.length > 0) {
    const responseIds = responses.map(r => r.id);
    const allAnswers = await db
      .select({
        questionId: answerSchema.questionId,
        isCorrect: answerSchema.isCorrect,
      })
      .from(answerSchema)
      .where(inArray(answerSchema.responseId, responseIds));

    for (const q of questions) {
      const qa = allAnswers.filter(a => a.questionId === q.id);
      const totalAnswered = qa.length;
      const totalCorrect = qa.filter(a => a.isCorrect === true).length;
      const correctRate = totalAnswered > 0 ? totalCorrect / totalAnswered : null;
      perQuestionStats.push({
        questionId: q.id,
        position: q.position,
        body: q.body,
        type: q.type,
        totalAnswered,
        totalCorrect,
        correctRate,
      });
    }
  } else {
    for (const q of questions) {
      perQuestionStats.push({
        questionId: q.id,
        position: q.position,
        body: q.body,
        type: q.type,
        totalAnswered: 0,
        totalCorrect: 0,
        correctRate: null,
      });
    }
  }

  // 難題 Top 3（排除 short_answer，且 totalAnswered >= 1）
  const hardQuestions = [...perQuestionStats]
    .filter(s => s.type !== 'short_answer' && s.totalAnswered >= 1 && s.correctRate !== null)
    .sort((a, b) => (a.correctRate ?? 1) - (b.correctRate ?? 1))
    .slice(0, 3);

  // Aggregate
  const attemptRows = responses.filter(r => r.studentToken !== null);
  const inProgressCount = attemptRows.filter(r => r.status === 'in_progress').length;
  const submittedCount = attemptRows.filter(r => r.status === 'submitted').length;
  const totalCount = attemptRows.length;
  const avgScorePercent = (() => {
    const scored = attemptRows.filter(
      r => r.status === 'submitted' && r.score !== null && r.totalPoints !== null && r.totalPoints > 0,
    );
    if (scored.length === 0) {
      return null;
    }
    const sum = scored.reduce((acc, r) => acc + (r.score! / r.totalPoints!) * 100, 0);
    return Math.round(sum / scored.length);
  })();

  return NextResponse.json({
    quiz: { id: quiz.id, title: quiz.title, totalQuestions },
    aggregate: {
      totalCount,
      inProgressCount,
      submittedCount,
      avgScorePercent,
    },
    students: attemptRows.map(r => ({
      responseId: r.id,
      tokenPrefix: r.studentToken!.substring(0, 8), // 老師只看前 8 碼當識別，全 token 不外洩
      nickname: r.studentName ?? '匿名',
      status: r.status,
      lastAnsweredQuestionIndex: r.lastAnsweredQuestionIndex,
      leaveCount: r.leaveCount,
      startedAt: r.startedAt.toISOString(),
      submittedAt: r.status === 'submitted' ? r.submittedAt.toISOString() : null,
      scorePercent: r.score !== null && r.totalPoints !== null && r.totalPoints > 0
        ? Math.round((r.score / r.totalPoints) * 100)
        : null,
    })),
    perQuestionStats,
    hardQuestions,
  });
}
