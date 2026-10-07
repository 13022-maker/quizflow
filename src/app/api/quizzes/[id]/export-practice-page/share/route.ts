/**
 * 把「匯出成靜態練習頁」的 HTML 上傳到 Vercel Blob，產生公開連結，
 * 讓老師不用下載也能直接複製連結 / 出示 QR Code 分享給學生。
 *
 * POST /api/quizzes/[id]/export-practice-page/share
 *   body: { start?: number, end?: number }（題號範圍，省略預設整份測驗）
 *
 * 撈資料/組 HTML 的邏輯跟 GET route（下載）共用，見 shared.ts。
 * 這個連結是「產生一次、長期公開」的靜態檔案，不比照 ShareModal 的
 * accessCode/到期時間/取消發佈機制（刻意簡化，見設計討論）。
 */
import { auth } from '@clerk/nextjs/server';
import { put } from '@vercel/blob';
import { NextResponse } from 'next/server';

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

  return NextResponse.json({
    url: blob.url,
    imported: result.imported,
    skipped: result.skipped,
  });
}
