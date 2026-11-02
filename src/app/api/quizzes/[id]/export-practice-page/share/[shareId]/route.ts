/**
 * 把既有的練習頁分享連結「更新到最新版」：用同一個題號範圍重新產生 HTML、上傳新的 Blob，
 * 再把 practice_page_share.url 指過去。分享網址（/api/p/[shareId]）不變，
 * 已經貼在 YouTube Shorts / LINE 的連結不用換，就能拿到作答統計與結束畫面。
 *
 * PUT /api/quizzes/[id]/export-practice-page/share/[shareId]
 *
 * 驗證：必須是該分享連結與該 quiz 的 owner（userId 比對，比照 share/route.ts 既有寫法）。
 * 舊的 Blob 檔不刪（刻意簡化，跟 share/route.ts 不做刪除一致）。
 */
import { auth } from '@clerk/nextjs/server';
import { put } from '@vercel/blob';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { practicePageShareSchema } from '@/models/Schema';

import { buildQuizPracticeHtml } from '../../shared';

export const runtime = 'nodejs';

export async function PUT(
  req: Request,
  { params }: { params: { id: string; shareId: string } },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: '分享連結功能尚未設定，請聯繫管理員' }, { status: 503 });
  }

  const quizId = Number(params.id);
  const shareId = Number(params.shareId);
  if (!Number.isInteger(quizId) || !Number.isInteger(shareId)) {
    return NextResponse.json({ error: '參數不合法' }, { status: 400 });
  }

  const [share] = await db
    .select({ id: practicePageShareSchema.id, questionRange: practicePageShareSchema.questionRange })
    .from(practicePageShareSchema)
    .where(and(
      eq(practicePageShareSchema.id, shareId),
      eq(practicePageShareSchema.quizId, quizId),
      eq(practicePageShareSchema.ownerId, userId),
    ))
    .limit(1);
  if (!share) {
    return NextResponse.json({ error: '找不到分享連結或無權限' }, { status: 404 });
  }

  const [startRaw, endRaw] = share.questionRange.split('-').map(n => Number.parseInt(n, 10));
  const result = await buildQuizPracticeHtml(
    userId,
    quizId,
    Number.isNaN(startRaw) ? undefined : startRaw,
    Number.isNaN(endRaw) ? undefined : endRaw,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const blob = await put(`practice-pages/${quizId}-${Date.now()}.html`, result.html, {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'text/html; charset=utf-8',
  });

  await db
    .update(practicePageShareSchema)
    .set({ url: blob.url, questionRange: `${result.resolvedStart}-${result.resolvedEnd}` })
    .where(eq(practicePageShareSchema.id, shareId));

  const origin = new URL(req.url).origin;
  return NextResponse.json({
    url: `${origin}/api/p/${shareId}`,
    imported: result.imported,
    skipped: result.skipped,
  });
}
