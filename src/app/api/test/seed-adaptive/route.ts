// E2E 測試專用 API：在 PGlite in-memory DB 預先建立指定 accessCode 的「適性練習」，
// 讓 E2E／curl 不需經過老師端 Clerk 登入流程，就能驗證學生免登入作答全流程。
//
// 三重安全閘（同 seed-quiz；任何一條不過直接 404，避免誤觸 production 資料）：
//   1. NODE_ENV === 'production' → 直接 404
//   2. ENABLE_TEST_ENDPOINTS !== 'true' → 直接 404
//   3. DATABASE_URL 已設（指向真實 DB）→ 拒絕

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSubject } from '@/libs/adaptive/subjects';
import { adaptivePracticeSchema } from '@/models/Schema';

export const runtime = 'nodejs';

const seedSchema = z.object({
  accessCode: z.string().min(1).max(64),
  title: z.string().min(1),
  subjectId: z.string().min(1), // cpp / python / calculus
});

export async function POST(req: Request) {
  // 安全閘 1：production build 永遠回 404
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  // 安全閘 2：必須顯式啟用，普通 dev 用不會撞到
  if (process.env.ENABLE_TEST_ENDPOINTS !== 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  // 安全閘 3：拒絕對外部 DB 寫入（PGlite 才安全）
  if (process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'Refusing to seed against external DATABASE_URL（請取消設定後再跑 E2E）' },
      { status: 403 },
    );
  }

  const parsed = seedSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  getSubject(parsed.data.subjectId); // 學科不存在直接丟錯

  // 冪等：同 accessCode 重複 seed 先刪舊資料（學生狀態與事件 cascade 一併清掉）
  await db
    .delete(adaptivePracticeSchema)
    .where(eq(adaptivePracticeSchema.accessCode, parsed.data.accessCode));

  const [practice] = await db
    .insert(adaptivePracticeSchema)
    .values({
      ownerId: 'e2e-test-teacher',
      subjectId: parsed.data.subjectId,
      title: parsed.data.title,
      accessCode: parsed.data.accessCode,
    })
    .returning();

  return NextResponse.json({ id: practice!.id, accessCode: practice!.accessCode });
}
