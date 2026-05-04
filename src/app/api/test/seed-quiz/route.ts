// E2E 測試專用 API：在 PGlite in-memory DB 預先建立指定 accessCode 的測驗 + 題目，
// 讓 Playwright 不需經過老師端 Clerk 登入流程，就能驗證學生公開作答頁。
//
// 三重安全閘（任何一條不過直接 404，避免誤觸 production 資料）：
//   1. NODE_ENV === 'production' → 直接 404
//   2. ENABLE_TEST_ENDPOINTS !== 'true' → 直接 404（playwright.config.ts 才會設）
//   3. DATABASE_URL 已設（指向真實 Neon）→ 拒絕（避免污染 prod / preview DB）

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { questionSchema, quizSchema } from '@/models/Schema';

export const runtime = 'nodejs';

// 限定可信的測試題型，避免測試端誤建 ranking/listening 等需額外欄位的題目
const seedSchema = z.object({
  accessCode: z.string().min(1).max(64),
  title: z.string().min(1),
  expiresAt: z.string().datetime().optional(), // ISO 字串，用來測試到期分支
  questions: z
    .array(
      z.object({
        body: z.string().min(1),
        type: z.enum([
          'single_choice',
          'multiple_choice',
          'true_false',
          'short_answer',
        ]),
        options: z
          .array(z.object({ id: z.string(), text: z.string() }))
          .nullable(),
        correctAnswers: z.array(z.string()).nullable(),
        points: z.number().int().min(1),
      }),
    )
    .min(1),
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = seedSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', detail: parsed.error.format() },
      { status: 400 },
    );
  }

  const { accessCode, title, expiresAt, questions } = parsed.data;

  // 同 accessCode 的舊資料先清掉（cascade 會帶走 question / response / answer）
  await db.delete(quizSchema).where(eq(quizSchema.accessCode, accessCode));

  const [quiz] = await db
    .insert(quizSchema)
    .values({
      ownerId: 'e2e-test-owner',
      title,
      accessCode,
      status: 'published',
      quizMode: 'standard',
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    })
    .returning();

  if (!quiz) {
    return NextResponse.json({ error: 'Failed to insert quiz' }, { status: 500 });
  }

  await db.insert(questionSchema).values(
    questions.map((q, i) => ({
      quizId: quiz.id,
      type: q.type,
      body: q.body,
      options: q.options,
      correctAnswers: q.correctAnswers,
      points: q.points,
      position: i,
    })),
  );

  return NextResponse.json({ ok: true, quizId: quiz.id, accessCode });
}
