'use server';

import { auth } from '@clerk/nextjs/server';
import { and, count, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getOrgPlanId } from '@/libs/Plan';
import { recordStreakActivity } from '@/libs/streak';
import { quizSchema } from '@/models/Schema';
import { PricingPlanList } from '@/utils/AppConfig';

// 生成 6 碼大寫英數房間碼（A-Z, 0-9）
function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// 生成不重複的房間碼（最多重試 5 次）
async function generateUniqueRoomCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    const [existing] = await db
      .select({ id: quizSchema.id })
      .from(quizSchema)
      .where(eq(quizSchema.roomCode, code))
      .limit(1);
    if (!existing) {
      return code;
    }
  }
  // 極低機率碰撞 5 次，回退到 nanoid
  return generateRoomCode() + generateRoomCode().slice(0, 1);
}

const CreateQuizSchema = z.object({
  title: z.string().min(1, '請輸入測驗標題').max(200),
  description: z.string().max(500).optional(),
  quizMode: z.enum(['standard', 'vocab']).optional(),
});

export type CreateQuizInput = z.infer<typeof CreateQuizSchema>;

export async function createQuiz(data: CreateQuizInput) {
  const { orgId, userId } = await auth();
  if (!orgId) {
    throw new Error('Unauthorized');
  }

  const parsed = CreateQuizSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? '資料格式錯誤' };
  }

  // VIP 白名單不限制
  const { isVipUser } = await import('@/libs/vip');
  if (await isVipUser()) {
    // VIP 直接跳過 quota 檢查
  } else {
  // 檢查免費方案測驗數量上限（999 代表無限制，即 Pro/Enterprise）
    const planId = await getOrgPlanId(orgId);
    const quizLimit = PricingPlanList[planId]?.features.website ?? 10;
    if (quizLimit < 999) {
      const [row] = await db
        .select({ total: count() })
        .from(quizSchema)
        .where(eq(quizSchema.ownerId, orgId));
      if ((row?.total ?? 0) >= quizLimit) {
        return { error: 'QUOTA_EXCEEDED' };
      }
    }
  }

  const roomCode = await generateUniqueRoomCode();
  const [inserted] = await db.insert(quizSchema).values({
    ownerId: orgId,
    title: parsed.data.title,
    description: parsed.data.description,
    accessCode: nanoid(8),
    roomCode,
    quizMode: parsed.data.quizMode ?? 'standard',
  }).returning();

  if (!inserted) {
    throw new Error('建立測驗失敗');
  }

  // 紀錄老師當日活動（streak）；失敗不阻擋測驗建立
  if (userId) {
    try {
      await recordStreakActivity(userId);
    } catch (err) {
      console.error('[Streak] createQuiz 記錄失敗', err);
    }
  }

  redirect(`/dashboard/quizzes/${inserted.id}/edit?ai=1`);
}

export async function updateQuiz(
  id: number,
  data: { title: string; description?: string; status: 'draft' | 'published' | 'closed' },
) {
  const { orgId } = await auth();
  if (!orgId) {
    throw new Error('Unauthorized');
  }

  await db
    .update(quizSchema)
    .set({ title: data.title, description: data.description, status: data.status })
    .where(and(eq(quizSchema.id, id), eq(quizSchema.ownerId, orgId)));

  revalidatePath(`/dashboard/quizzes/${id}/edit`);
  revalidatePath('/dashboard/quizzes');
}

// 更新測驗的防作弊與顯示設定
export async function updateQuizSettings(
  id: number,
  data: {
    shuffleQuestions?: boolean;
    shuffleOptions?: boolean;
    allowedAttempts?: number | null;
    showAnswers?: boolean;
    timeLimitSeconds?: number | null;
    preventLeave?: boolean;
    expiresAt?: Date | null;
  },
) {
  const { orgId } = await auth();
  if (!orgId) {
    throw new Error('Unauthorized');
  }

  await db
    .update(quizSchema)
    .set(data)
    .where(and(eq(quizSchema.id, id), eq(quizSchema.ownerId, orgId)));

  revalidatePath(`/dashboard/quizzes/${id}/edit`);
}

export async function deleteQuiz(id: number) {
  const { orgId } = await auth();
  if (!orgId) {
    throw new Error('Unauthorized');
  }

  await db
    .delete(quizSchema)
    .where(and(eq(quizSchema.id, id), eq(quizSchema.ownerId, orgId)));

  revalidatePath('/dashboard/quizzes');
}
