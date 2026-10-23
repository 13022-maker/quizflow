// pdf-lib、Buffer 是 Node.js 專屬 API，必須明確指定 Node.js Runtime
import { Buffer } from 'node:buffer';

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { saveGeneratedSubject } from '@/actions/adaptiveActions';
import { buildPageHintPrompt, PdfPreprocessError, preparePdfForAI } from '@/lib/ai/pdfPreprocess';
import type { Media } from '@/lib/ai/textModel';
import { friendlyAIGenerationError, generateSubject, generateSubjectSchema } from '@/libs/adaptive/generate-subject';
import {
  fileExtToImageMimeType,
  validateSubjectUploadFiles,
} from '@/libs/adaptive/subjectFileValidation';

export const runtime = 'nodejs';
export const maxDuration = 60;

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

  // 加密 PDF 無法裁切時，附在主題後面讓 AI 只看選取頁（generateSubject 的 prompt 由主題組成）
  let topicForAI = topic;

  if (isPdf) {
    // 跟 generate-from-file/route.ts 共用 preparePdfForAI：一般 PDF 依範圍裁切；
    // 加密 PDF 送原始 bytes（copyPages 會產生密文亂碼，見 src/lib/ai/pdfPreprocess.ts）；
    // 損毀 / 需密碼 / 範圍錯誤 → 400（過去 PDFDocument.load 在 try 外面，直接 500）
    try {
      const prepared = await preparePdfForAI(new Uint8Array(await firstFile.arrayBuffer()), { startPage, endPage });
      media.push({
        mimeType: 'application/pdf',
        base64: Buffer.from(prepared.bytes).toString('base64'),
      });
      topicForAI = topic + buildPageHintPrompt(prepared.pageHint);
    } catch (err) {
      if (err instanceof PdfPreprocessError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }
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

  let generated: Awaited<ReturnType<typeof generateSubject>>;
  try {
    generated = await generateSubject(topicForAI, undefined, media);
  } catch (err) {
    console.error('[generate-subject-from-file] AI 生成失敗：', err);
    return NextResponse.json({ error: friendlyAIGenerationError(err) }, { status: 500 });
  }

  const result = await saveGeneratedSubject(userId, topic, generated);
  return NextResponse.json(result);
}
