/**
 * 靜態練習頁分享連結代理：學生點分享連結實際打到的網址。
 *
 * 為什麼不直接把 Vercel Blob 的網址給學生：Blob 對 .html 檔案一律回傳
 * `Content-Disposition: attachment`（防止 blob storage 網域被拿去放可執行
 * 任意 script 的頁面當釣魚/XSS 用），瀏覽器打開會變成強制下載,不會渲染頁面。
 * 這支 route 代理把 blob 內容原樣讀出來，用我們自己的網域、不帶 attachment
 * header 回傳，瀏覽器才會正常顯示練習頁。
 *
 * 公開、免登入（見 middleware.ts isPublicApiRoute）——練習頁本來就設計成
 * 學生免登入就能作答，這支 route 只是中介，不應該多一道登入關卡。
 */
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { practicePageShareSchema } from '@/models/Schema';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const id = Number(params.id);
  if (Number.isNaN(id)) {
    return new NextResponse('找不到這份練習頁', { status: 404 });
  }

  const [share] = await db
    .select({ url: practicePageShareSchema.url })
    .from(practicePageShareSchema)
    .where(eq(practicePageShareSchema.id, id))
    .limit(1);

  if (!share) {
    return new NextResponse('找不到這份練習頁，連結可能已失效', { status: 404 });
  }

  const blobRes = await fetch(share.url);
  if (!blobRes.ok) {
    return new NextResponse('練習頁讀取失敗，請稍後再試', { status: 502 });
  }

  const html = await blobRes.text();
  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
