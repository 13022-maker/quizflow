// Buffer.from() 是 Node.js 專屬 API，必須明確指定 Node.js Runtime
// 否則 Vercel 預設 Edge Runtime 不支援，會整個壞掉
export const runtime = 'nodejs';

import { auth } from '@clerk/nextjs/server';
import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

const client = new Anthropic();

const DIFF_LABELS: Record<string, string> = {
  easy: '簡單（基礎記憶型）',
  medium: '中等（理解應用型）',
  hard: '困難（分析評估型）',
};

const TYPE_LABELS: Record<string, string> = {
  mc: '選擇題（4選1，標明正確選項字母）',
  tf: '是非題（答案為「○」或「✕」）',
  fill: '填空題（用 ___ 標空格，附答案）',
  short: '簡答題（附參考答案）',
};

export async function POST(request: Request) {
  // debug：確認 cookie 有沒有帶進來
  console.log('generate-from-file called, cookie:', request.headers.get('cookie')?.slice(0, 50));
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: '未登入' }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const typesRaw = formData.get('types') as string;
  const count = parseInt(formData.get('count') as string) || 5;
  const difficulty = (formData.get('difficulty') as string) || 'medium';

  if (!file) return NextResponse.json({ error: '請上傳檔案' }, { status: 400 });

  const types: string[] = JSON.parse(typesRaw || '["mc"]');
  const diffLabel = DIFF_LABELS[difficulty] || '中等';
  const typesPrompt = types.map(t => `- ${TYPE_LABELS[t]}，共 ${count} 題`).join('\n');

  const prompt = `請根據以上文件內容出題。

難度：${diffLabel}
出題類型：
${typesPrompt}

規則：
1. 所有題目必須根據文件的實際內容，不可自行捏造
2. 只回傳合法 JSON，不要 markdown 或任何說明文字
3. JSON 格式：
{
  "title": "根據文件內容自動命名的試卷標題",
  "questions": [
    { "type": "mc", "question": "題目", "options": ["(A)..","(B)..","(C)..","(D).."], "answer": "A", "explanation": "說明" },
    { "type": "tf", "question": "敘述句題目", "answer": "○", "explanation": "說明" },
    { "type": "fill", "question": "含 ___ 的題目", "answer": "答案", "explanation": "" },
    { "type": "short", "question": "簡答題目", "answer": "參考答案", "explanation": "" }
  ]
}
每種題型各出 ${count} 題，只出勾選的題型。`;

  // 轉 base64
  const arrayBuffer = await file.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
  const isPDF = ext === 'pdf';

  let content: Anthropic.MessageParam['content'];

  if (isImage) {
    const mediaMap: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg',
      png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    };
    content = [
      { type: 'image', source: { type: 'base64', media_type: (mediaMap[ext] || 'image/png') as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: base64 } },
      { type: 'text', text: prompt },
    ];
  } else if (isPDF) {
    content = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
      { type: 'text', text: prompt },
    ];
  } else {
    // DOCX：告知 Claude 是 Word 文件
    content = [
      { type: 'document', source: { type: 'base64', media_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as 'application/pdf', data: base64 } },
      { type: 'text', text: prompt },
    ];
  }

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content }],
    });

    const raw = (message.content[0] as { type: string; text: string }).text ?? '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return NextResponse.json({ error: 'AI 回傳格式錯誤，請重試' }, { status: 500 });
    }

    const result = JSON.parse(match[0]);
    return NextResponse.json(result);
  }
  catch (err) {
    const message = err instanceof Error ? err.message : '未知錯誤';
    return NextResponse.json({ error: `AI 命題失敗：${message}` }, { status: 500 });
  }
}
