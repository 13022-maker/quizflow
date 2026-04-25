/**
 * 題目圖片上傳 API（Vercel Blob）
 * 路徑結構：quiz-images/{quizId}/{timestamp}-{random}.{ext}
 * 限制：
 *   - 必須登入且為該 quiz 的 owner（userId 比對）
 *   - 僅接受 image/*
 *   - 單檔 < 5 MB
 */

import { auth } from '@clerk/nextjs/server';
import { put } from '@vercel/blob';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { quizSchema } from '@/models/Schema';

export const runtime = 'nodejs';

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(
  req: Request,
  { params }: { params: { quizId: string } },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    const quizId = Number(params.quizId);
    if (Number.isNaN(quizId)) {
      return NextResponse.json({ error: 'quizId 不合法' }, { status: 400 });
    }

    // 驗證 quiz 所有權
    const [quiz] = await db
      .select({ id: quizSchema.id })
      .from(quizSchema)
      .where(and(eq(quizSchema.id, quizId), eq(quizSchema.ownerId, userId)))
      .limit(1);
    if (!quiz) {
      return NextResponse.json({ error: '找不到測驗或無權限' }, { status: 404 });
    }

    const formData = await req.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '缺少檔案' }, { status: 400 });
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: '僅接受圖片格式' }, { status: 400 });
    }

    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: '檔案超過 5 MB 上限' }, { status: 400 });
    }

    // 產生檔名：timestamp-random.ext（避免衝突）
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const pathname = `quiz-images/${quizId}/${filename}`;

    const blob = await put(pathname, file, {
      access: 'public',
      addRandomSuffix: false, // 路徑已含 random
      contentType: file.type,
    });

    return NextResponse.json({ url: blob.url });
  } catch (err) {
    console.error('[upload quiz-image] 失敗', err);
    const message = err instanceof Error ? err.message : '上傳失敗';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
