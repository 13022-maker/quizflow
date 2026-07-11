'use server';

/**
 * 適性學習（Adaptive Learning）Server Actions — 教師端
 * 老師建立「適性練習」（選學科＋命名）→ 取得分享連結（accessCode）發給學生。
 * 學生端走公開 API（/api/adaptive/[code]/*），不經過這裡。
 */
import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSubject } from '@/libs/adaptive/subjects';
import { adaptivePracticeSchema } from '@/models/Schema';

const createPracticeSchema = z.object({
  title: z.string().trim().min(1, '請輸入練習名稱').max(100),
  subjectId: z.string().min(1),
});

/** 建立適性練習：分享碼用 8 碼 nanoid（防循序猜測），成功後導向儀表板 */
export async function createAdaptivePractice(formData: FormData) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('請先登入');
  }

  const parsed = createPracticeSchema.parse({
    title: formData.get('title'),
    subjectId: formData.get('subjectId'),
  });
  getSubject(parsed.subjectId); // 學科不存在直接丟錯（含可用清單）

  const [practice] = await db
    .insert(adaptivePracticeSchema)
    .values({
      ownerId: userId,
      subjectId: parsed.subjectId,
      title: parsed.title,
      accessCode: nanoid(8),
    })
    .returning();

  revalidatePath('/dashboard/adaptive');
  redirect(`/dashboard/adaptive/${practice!.id}`);
}

/** 刪除適性練習（連同學生狀態與事件，schema 已設 onDelete: cascade） */
export async function deleteAdaptivePractice(practiceId: number) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('請先登入');
  }

  await db
    .delete(adaptivePracticeSchema)
    .where(
      and(
        eq(adaptivePracticeSchema.id, practiceId),
        eq(adaptivePracticeSchema.ownerId, userId), // 只能刪自己的
      ),
    );

  revalidatePath('/dashboard/adaptive');
}
