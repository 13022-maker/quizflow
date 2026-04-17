/**
 * 聽力題音檔上傳 API（Vercel Blob）
 * 路徑結構：audio/{quizId}/{timestamp}-{random}.{ext}
 * 限制：
 *   - 必須登入且為該 quiz 的 owner（orgId 比對）
 *   - 僅接受 audio/*
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
    const { orgId } = await auth();
    if (!orgId) {
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
      .where(and(eq(quizSchema.id, quizId), eq(quizSchema.ownerId, orgId)))
      .limit(1);
    if (!quiz) {
      return NextResponse.json({ error: '找不到測驗或無權限' }, { status: 404 });
    }

    const formData = await req.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '缺少檔案' }, { status: 400 });
    }

    if (!file.type.startsWith('audio/')) {
      return NextResponse.json({ error: '僅接受音檔格式（mp3、wav、m4a 等）' }, { status: 400 });
    }

    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: '檔案超過 5 MB 上限' }, { status: 400 });
    }

    // 產生檔名：timestamp-random.ext
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'mp3';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const pathname = `audio/${quizId}/${filename}`;

    const blob = await put(pathname, file, {
      access: 'public',
      addRandomSuffix: false,
      contentType: file.type,
    });

    return NextResponse.json({ url: blob.url });
  } catch (err) {
    console.error('[upload audio] 失敗', err);
    const message = err instanceof Error ? err.message : '上傳失敗';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
