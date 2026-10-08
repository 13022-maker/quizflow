/**
 * 「匯出成靜態練習頁」的分享連結：上傳 HTML 到 Vercel Blob 產生公開連結，
 * 讓老師不用下載也能直接複製連結 / 出示 QR Code 分享給學生。
 *
 * POST /api/quizzes/[id]/export-practice-page/share
 *   body: { start?: number, end?: number }（題號範圍，省略預設整份測驗）
 *   產生後會寫一筆 practicePageShareSchema 記錄，供 GET 查詢歷史
 *
 * GET /api/quizzes/[id]/export-practice-page/share
 *   回傳該測驗過去產生過的分享連結（依產生時間新到舊）
 *
 * 撈資料/組 HTML 的邏輯跟 GET .../export-practice-page route（下載）共用，見 shared.ts。
 * 這個連結是「產生一次、長期公開」的靜態檔案，不比照 ShareModal 的
 * accessCode/到期時間/取消發佈機制，也不做刪除（刻意簡化，見設計討論）。
 *
 * 回給前端的連結不是 Vercel Blob 原始網址，而是 /api/p/[id] 代理網址——
 * Blob 對 .html 強制 Content-Disposition: attachment，瀏覽器打開會變下載
 * 而不是渲染頁面，見 api/p/[id]/route.ts 開頭說明。
 */
import { auth } from '@clerk/nextjs/server';
import { put } from '@vercel/blob';
import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { practicePageShareSchema } from '@/models/Schema';

import { buildQuizPracticeHtml } from '../shared';

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

  const result = await buildQuizPracticeHtml(userId, quizId, start, end);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const filename = `practice-pages/${quizId}-${Date.now()}.html`;
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
    .where(and(eq(practicePageShareSchema.quizId, quizId), eq(practicePageShareSchema.ownerId, userId)))
    .orderBy(desc(practicePageShareSchema.createdAt));

  const origin = new URL(req.url).origin;
  const shares = rows.map(row => ({ ...row, url: `${origin}/api/p/${row.id}` }));

  return NextResponse.json({ shares });
}
