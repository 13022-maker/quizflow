/**
 * 「匯出成靜態填空練習頁」的分享連結：上傳 HTML 到 Vercel Blob 產生公開連結。
 * 跟 export-practice-page/share/route.ts（單選/是非題練習頁）並列的同一套機制，
 * 只是 kind 存 'fillblank'，GET 查歷史時也只撈 kind='fillblank' 的記錄，避免
 * 跟選擇題練習頁的分享連結混在一起顯示。
 *
 * POST /api/quizzes/[id]/export-fillblank-practice-page/share
 *   body: { start?: number, end?: number }
 * GET /api/quizzes/[id]/export-fillblank-practice-page/share
 *   回傳該測驗過去產生過的填空練習頁分享連結
 *
 * 回給前端的連結同樣是 /api/p/[id] 代理網址，理由見 api/p/[id]/route.ts。
 */
import { auth } from '@clerk/nextjs/server';
import { put } from '@vercel/blob';
import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { practicePageShareSchema } from '@/models/Schema';

import { buildQuizFillBlankPracticeHtml } from '../shared';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: '分享連結功能尚未設定，請聯繫管理員' }, { status: 503 });
  }

  const quizId = Number(params.id);
  const body = await req.json().catch(() => ({}));
  const start = typeof body.start === 'number' ? body.start : undefined;
  const end = typeof body.end === 'number' ? body.end : undefined;

  const result = await buildQuizFillBlankPracticeHtml(userId, quizId, start, end);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const filename = `fillblank-practice-pages/${quizId}-${Date.now()}.html`;
  const blob = await put(filename, result.html, {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'text/html; charset=utf-8',
  });

  const questionRange = `${result.resolvedStart}-${result.resolvedEnd}`;
  const [row] = await db.insert(practicePageShareSchema).values({
    quizId,
    ownerId: userId,
    url: blob.url,
    questionRange,
    answerKey: result.answerKey,
    kind: 'fillblank',
  }).returning();

  const origin = new URL(req.url).origin;

  return NextResponse.json({
    url: `${origin}/api/p/${row!.id}`,
    imported: result.imported,
    skipped: result.skipped,
  });
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  const quizId = Number(params.id);
  if (Number.isNaN(quizId)) {
    return NextResponse.json({ error: 'quizId 不合法' }, { status: 400 });
  }

  const rows = await db
    .select({
      id: practicePageShareSchema.id,
      questionRange: practicePageShareSchema.questionRange,
      createdAt: practicePageShareSchema.createdAt,
    })
    .from(practicePageShareSchema)
    .where(and(
      eq(practicePageShareSchema.quizId, quizId),
      eq(practicePageShareSchema.ownerId, userId),
      eq(practicePageShareSchema.kind, 'fillblank'),
    ))
    .orderBy(desc(practicePageShareSchema.createdAt));

  const origin = new URL(req.url).origin;
  const shares = rows.map(row => ({ ...row, url: `${origin}/api/p/${row.id}` }));

  return NextResponse.json({ shares });
}
