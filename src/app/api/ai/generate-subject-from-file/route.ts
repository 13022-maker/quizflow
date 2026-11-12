// pdf-lib、Buffer 是 Node.js 專屬 API，必須明確指定 Node.js Runtime
import { Buffer } from 'node:buffer';

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';

import { saveGeneratedSubject } from '@/actions/adaptiveActions';
import type { Media } from '@/lib/ai/textModel';
import { friendlyAIGenerationError, generateSubject, generateSubjectSchema } from '@/libs/adaptive/generate-subject';
import {
  fileExtToImageMimeType,
  validateSubjectUploadFiles,
} from '@/libs/adaptive/subjectFileValidation';
import {
  createHeartbeatNdjsonStream,
  NDJSON_CONTENT_TYPE,
} from '@/libs/adaptive/subjectGenerationStream';
import { resolvePdfPageRange } from '@/libs/pdfPageLimit';

export const runtime = 'nodejs';
// 生成學科約需 1～3 分鐘（Opus thinking + 驗證失敗重試一次），60 秒會被 Vercel 砍掉，
// 對齊 /api/test/generate-subject 的 300 秒
export const maxDuration = 300;

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  const formData = await request.formData();
  const uploaded = formData.getAll('file').filter((v): v is File => v instanceof File);
  const startPage = Number.parseInt(formData.get('startPage') as string) || 1;
  const endPage = Number.parseInt(formData.get('endPage') as string) || 0;

  let topic: string;
  try {
    ({ topic } = generateSubjectSchema.pick({ topic: true }).parse({
      topic: formData.get('topic'),
    }));
  } catch {
    return NextResponse.json({ error: '請輸入單元主題（至少 2 個字）' }, { status: 400 });
  }

  const fileValidation = validateSubjectUploadFiles(uploaded.map(f => f.name));
  if (!fileValidation.ok) {
    return NextResponse.json({ error: fileValidation.error }, { status: 400 });
  }

  const firstFile = uploaded[0]!;
  const isPdf = firstFile.name.split('.').pop()?.toLowerCase() === 'pdf';
  const media: Media[] = [];

  if (isPdf) {
    // 跟 generate-from-file/route.ts 一致：ignoreEncryption + 重新輸出乾淨 PDF，
    // 避免加密限制讓 AI 多模態讀不到內容，也避免整份大 PDF 直接送給 AI 拖慢生成。
    const arrayBuffer = await firstFile.arrayBuffer();
    const srcDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
    const actualTotalPages = srcDoc.getPageCount();

    const range = resolvePdfPageRange({
      actualTotalPages,
      requestedStartPage: startPage,
      requestedEndPage: endPage,
    });
    if (!range.ok) {
      return NextResponse.json({ error: range.error }, { status: 400 });
    }

    const newDoc = await PDFDocument.create();
    const indices = Array.from(
      { length: range.endPage - range.startPage + 1 },
      (_, i) => range.startPage - 1 + i,
    );
    const copiedPages = await newDoc.copyPages(srcDoc, indices);
    copiedPages.forEach(page => newDoc.addPage(page));
    const pdfBytes = await newDoc.save();

    media.push({
      mimeType: 'application/pdf',
      base64: Buffer.from(pdfBytes).toString('base64'),
    });
  } else {
    for (const f of uploaded) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      const buf = await f.arrayBuffer();
      media.push({
        mimeType: fileExtToImageMimeType(ext),
        base64: Buffer.from(buf).toString('base64'),
      });
    }
  }

  // 生成要 1～3 分鐘：改回傳 NDJSON 串流並定時送心跳。
  // 舊版等 AI 完成才回應，iOS Safari 約 60 秒收不到任何位元組就斷線 → 前端只看到「Load failed」。
  const stream = createHeartbeatNdjsonStream(
    async () => {
      const generated = await generateSubject(topic, undefined, media);
      return saveGeneratedSubject(userId, topic, generated);
    },
    {
      toErrorMessage: (err) => {
        console.error('[generate-subject-from-file] AI 生成失敗：', err);
        return friendlyAIGenerationError(err);
      },
    },
  );

  return new Response(stream, {
    headers: {
      'Content-Type': NDJSON_CONTENT_TYPE,
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
