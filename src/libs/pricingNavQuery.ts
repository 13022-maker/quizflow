// navbar 定價入口用的 DB 查詢（純規則在 pricingNav.ts，拆開讓單測不載入 DB / env）

import { and, count, eq, inArray } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { quizSchema } from '@/models/Schema';

/** 計算該老師實際出卷數（published + closed，草稿不算） */
export async function countPublishedQuizzes(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(quizSchema)
    .where(and(
      eq(quizSchema.ownerId, userId),
      inArray(quizSchema.status, ['published', 'closed']),
    ));

  return row?.total ?? 0;
}
