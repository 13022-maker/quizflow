'use server';

import { auth } from '@clerk/nextjs/server';
import { and, between, eq, inArray, max } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { quizSchema, responseSchema } from '@/models/Schema';

// 型別定義
export type StatQuiz = { id: number; title: string; createdAt: string };
export type StatResponse = {
  quizId: number;
  studentName: string;
  score: number | null;
  totalPoints: number | null;
};

// 輸入驗證
const StatisticsInputSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式錯誤'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式錯誤'),
});

// 跨試卷成績查詢：依日期區間篩選試卷，回傳試卷清單與每位學生的最高分
export async function getStatisticsData(input: { startDate: string; endDate: string }): Promise<{
  quizzes: StatQuiz[];
  responses: StatResponse[];
  error?: string;
}> {
  const { userId } = await auth();
  if (!userId) {
    return { quizzes: [], responses: [], error: '未登入' };
  }

  const parsed = StatisticsInputSchema.safeParse(input);
  if (!parsed.success) {
    return { quizzes: [], responses: [], error: parsed.error.errors[0]?.message ?? '資料格式錯誤' };
  }

  const { startDate, endDate } = parsed.data;
  // endDate 加一天，讓 BETWEEN 包含當天整天
  const endDatePlusOne = new Date(endDate);
  endDatePlusOne.setDate(endDatePlusOne.getDate() + 1);

  // 查詢該老師在日期區間內的所有試卷
  const quizzes = await db
    .select({
      id: quizSchema.id,
      title: quizSchema.title,
      createdAt: quizSchema.createdAt,
    })
    .from(quizSchema)
    .where(
      and(
        eq(quizSchema.ownerId, userId),
        between(quizSchema.createdAt, new Date(startDate), endDatePlusOne),
      ),
    )
    .orderBy(quizSchema.createdAt);

  if (quizzes.length === 0) {
    return { quizzes: [], responses: [] };
  }

  const quizIds = quizzes.map(q => q.id);

  // 同一 studentName + quizId 取最高分
  const responses = await db
    .select({
      quizId: responseSchema.quizId,
      studentName: responseSchema.studentName,
      score: max(responseSchema.score),
      totalPoints: max(responseSchema.totalPoints),
    })
    .from(responseSchema)
    .where(inArray(responseSchema.quizId, quizIds))
    .groupBy(responseSchema.quizId, responseSchema.studentName);

  return {
    quizzes: quizzes.map(q => ({
      id: q.id,
      title: q.title,
      createdAt: q.createdAt.toISOString(),
    })),
    responses: responses.map(r => ({
      quizId: r.quizId,
      studentName: r.studentName ?? '匿名',
      score: r.score !== null ? Number(r.score) : null,
      totalPoints: r.totalPoints !== null ? Number(r.totalPoints) : null,
    })),
  };
}
