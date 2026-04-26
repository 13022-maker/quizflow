'use server';

import { auth } from '@clerk/nextjs/server';
import { and, count, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { ensureUniqueSlug, generateSlug } from '@/lib/slug';
import { getUserPlanId } from '@/libs/Plan';
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
  const { userId } = await auth();
  if (!userId) {
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
    const planId = await getUserPlanId(userId);
    const quizLimit = PricingPlanList[planId]?.features.website ?? 10;
    if (quizLimit < 999) {
      const [row] = await db
        .select({ total: count() })
        .from(quizSchema)
        .where(eq(quizSchema.ownerId, userId));
      if ((row?.total ?? 0) >= quizLimit) {
        return { error: 'QUOTA_EXCEEDED' };
      }
    }
  }

  const roomCode = await generateUniqueRoomCode();
  // 回傳新建測驗完整列以取得 id，用於 redirect 直接進入編輯頁
  const [inserted] = await db
    .insert(quizSchema)
    .values({
      ownerId: userId,
      title: parsed.data.title,
      description: parsed.data.description,
      accessCode: nanoid(8), // 8 碼隨機英數字，作為學生作答連結
      roomCode, // 6 碼大寫英數房間碼
      quizMode: parsed.data.quizMode ?? 'standard',
    })
    .returning();

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

  // 建完直接進編輯頁；ai=1 觸發 AI 出題對話框、just_created=1 顯示審題引導 banner
  redirect(`/dashboard/quizzes/${inserted.id}/edit?ai=1&just_created=1`);
}

export async function updateQuiz(
  id: number,
  data: { title: string; description?: string; status: 'draft' | 'published' | 'closed' },
) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Unauthorized');
  }

  await db
    .update(quizSchema)
    .set({ title: data.title, description: data.description, status: data.status })
    .where(and(eq(quizSchema.id, id), eq(quizSchema.ownerId, userId)));

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
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Unauthorized');
  }

  await db
    .update(quizSchema)
    .set(data)
    .where(and(eq(quizSchema.id, id), eq(quizSchema.ownerId, userId)));

  revalidatePath(`/dashboard/quizzes/${id}/edit`);
}

export async function deleteQuiz(id: number) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Unauthorized');
  }

  await db
    .delete(quizSchema)
    .where(and(eq(quizSchema.id, id), eq(quizSchema.ownerId, userId)));

  revalidatePath('/dashboard/quizzes');
}

// ---------- 社群化 Phase 1 commit 2:visibility 切換 ----------

const VisibilitySchema = z.object({
  quizId: z.number(),
  visibility: z.enum(['private', 'unlisted', 'public']),
});

/**
 * 切換 quiz visibility(private / unlisted / public)
 *
 * 行為(Phase 1 commit 2 設計決定):
 * - 切到 unlisted 或 public:slug 若空則自動產 + publishedAt 若空則設 now
 * - 切回 private:slug 跟 publishedAt 保留(避免 break 既有分享連結 → 已分享出去的 URL 不會 404)
 * - 漸進整合 isMarketplace:public → true,其他 → false
 *   (Phase 2 commit 3+ 才把 isMarketplace 完全 deprecated)
 */
export async function setQuizVisibility(input: {
  quizId: number;
  visibility: 'private' | 'unlisted' | 'public';
}) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('未登入');
  }

  const parsed = VisibilitySchema.safeParse(input);
  if (!parsed.success) {
    return { error: '參數錯誤' as const };
  }

  const { quizId, visibility } = parsed.data;

  // 確認 ownership 並拿目前 slug / publishedAt(避免 race condition 重複產 slug)
  const [quiz] = await db
    .select({
      id: quizSchema.id,
      slug: quizSchema.slug,
      publishedAt: quizSchema.publishedAt,
    })
    .from(quizSchema)
    .where(and(eq(quizSchema.id, quizId), eq(quizSchema.ownerId, userId)))
    .limit(1);

  if (!quiz) {
    return { error: '找不到測驗或無權限' as const };
  }

  const updates: {
    visibility: 'private' | 'unlisted' | 'public';
    slug?: string;
    publishedAt?: Date;
    isMarketplace: boolean;
  } = {
    visibility,
    isMarketplace: visibility === 'public',
  };

  // 切到 unlisted/public 且 slug 還沒產 → 自動產(nanoid 8 碼,collision retry 5 次)
  if ((visibility === 'unlisted' || visibility === 'public') && !quiz.slug) {
    updates.slug = await ensureUniqueSlug(generateSlug(), quizId);
  }

  // 第一次「發佈」(publishedAt 還沒設)→ 記錄首次發佈時間
  if ((visibility === 'unlisted' || visibility === 'public') && !quiz.publishedAt) {
    updates.publishedAt = new Date();
  }

  await db.update(quizSchema).set(updates).where(eq(quizSchema.id, quizId));

  revalidatePath('/marketplace');
  revalidatePath(`/dashboard/quizzes/${quizId}/edit`);
  return {
    success: true as const,
    slug: updates.slug ?? quiz.slug ?? null,
  };
}
