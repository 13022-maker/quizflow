/**
 * 題庫匯入 API — 「貼上題庫文字」或「上傳題庫 PDF」共用同一支
 *
 * 設計原則（跟其他 AI 出題 route 最大的差異）：
 * 題幹、選項、正確答案完全來自 examBankParser 的解析結果（regex 硬切字元），
 * AI 完全不碰這三樣東西，只負責幫已經確定答案的題目補寫詳解——避免像一般
 * 「主題出題」那樣讓 AI 自己生成題目與答案，這裡的正解必須 100% 對應題庫
 * 本身標示的官方答案，不容許 AI 判斷或修改。
 */
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { checkAndIncrementAiUsage } from '@/actions/aiUsageActions';
import { type ParsedQuestion, parseExamBankText } from '@/lib/ai/examBankParser';
import { extractPdfText } from '@/lib/ai/pdfTextExtract';
import { generateAIText } from '@/lib/ai/textModel';

export const runtime = 'nodejs';
export const maxDuration = 60;

// 單次匯入題數上限：避免超大題庫一次塞爆 AI 詳解 prompt / token 額度
const MAX_QUESTIONS = 60;

function letterOf(index: number): string {
  return String.fromCharCode(65 + index); // 0 -> A, 1 -> B, ...
}

function buildExplainPrompt(questions: ParsedQuestion[]): string {
  const list = questions
    .map((q, i) => {
      const optsText = q.options.map((o, oi) => `${letterOf(oi)}. ${o}`).join('　');
      return `${i + 1}. ${q.question}\n選項：${optsText}\n正確答案：${letterOf(q.correctIndex)}. ${q.options[q.correctIndex]}`;
    })
    .join('\n\n');

  return `你是一位專業的技術士檢定培訓講師。以下每一題的題幹、選項、正確答案都已經確定，不需要你判斷或修改，你的唯一任務是針對每一題寫一段 50~100 字的繁體中文詳解，說明正確答案為什麼對、以及容易誤選的選項錯在哪裡。

規則：
1. 絕對不要更改題目文字、選項內容或正確答案，你的任務只有寫詳解
2. 依照題號順序輸出，只回傳合法 JSON，不要 markdown 或任何說明文字
3. JSON 格式：{ "explanations": ["第1題的詳解文字", "第2題的詳解文字", ...] }，陣列長度必須等於題目數量 ${questions.length}

題目列表：
${list}`;
}

// 用陣列順序(index)對應解析結果，不能用題目本身標示的題號——同一份文字如果貼了
// 多個工作項目/章節，題號常常會從 1 重新編號，用題號當 key 會互相覆蓋掉。
function parseExplanationResponse(raw: string, expectedCount: number): Record<number, string> {
  const match = raw.match(/\{[\s\S]*\}/);
  const jsonText = match ? match[0] : raw;
  const result: Record<number, string> = {};
  try {
    const parsed = JSON.parse(jsonText);
    const list = Array.isArray(parsed?.explanations) ? parsed.explanations : [];
    for (let i = 0; i < Math.min(list.length, expectedCount); i++) {
      if (typeof list[i] === 'string' && list[i].trim()) {
        result[i] = list[i].trim();
      }
    }
  } catch (err) {
    console.warn('[parse-exam-bank] AI 詳解回傳非合法 JSON：', raw.slice(0, 300), err instanceof Error ? err.message : err);
  }
  return result;
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  const quota = await checkAndIncrementAiUsage(userId);
  if (!quota.allowed) {
    return NextResponse.json(
      { error: quota.reason, upgradeRequired: true, remaining: 0 },
      { status: 403 },
    );
  }

  const contentType = request.headers.get('content-type') ?? '';
  let rawText = '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '請上傳題庫 PDF 檔案' }, { status: 400 });
    }
    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: '目前只支援 PDF 檔案' }, { status: 400 });
    }
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      rawText = await extractPdfText(data);
    } catch (err) {
      console.error('[parse-exam-bank] PDF 文字擷取失敗：', err);
      return NextResponse.json(
        { error: 'PDF 文字擷取失敗，可能是掃描圖檔式 PDF（沒有可反白複製的文字層），請改用「貼上文字」模式手動貼題目' },
        { status: 400 },
      );
    }
  } else {
    const body = await request.json().catch(() => null);
    rawText = typeof body?.text === 'string' ? body.text : '';
  }

  if (!rawText.trim()) {
    return NextResponse.json({ error: '沒有讀到任何文字內容' }, { status: 400 });
  }
  if (rawText.length > 200_000) {
    return NextResponse.json({ error: '內容過長，請分批貼上或分批上傳' }, { status: 400 });
  }

  const { questions, failedSegments } = parseExamBankText(rawText);

  if (questions.length === 0) {
    return NextResponse.json(
      {
        error: '沒有解析出任何題目，請確認格式是否符合「題號.(正解) 題幹 ①②③④選項」或「(正解)題號. 題幹 (1)(2)(3)(4)選項」',
        failedSegments: failedSegments.slice(0, 10),
      },
      { status: 400 },
    );
  }

  const truncated = questions.length > MAX_QUESTIONS;
  const limited = questions.slice(0, MAX_QUESTIONS);

  // AI 只負責補詳解；就算 AI 呼叫整個失敗，題目本身(題幹/選項/正解)已經解析好了，
  // 不要讓詳解生成失敗連累整個匯入流程 —— 留白讓老師自己補即可。
  let explanations: Record<number, string> = {};
  try {
    const { text } = await generateAIText({
      prompt: buildExplainPrompt(limited),
      json: true,
      maxTokens: 8192,
    });
    explanations = parseExplanationResponse(text, limited.length);
  } catch (err) {
    console.warn('[parse-exam-bank] AI 補詳解失敗，詳解留白讓老師自行補充：', err instanceof Error ? err.message : err);
  }

  const outQuestions = limited.map((q, i) => ({
    type: 'mc' as const,
    question: q.question,
    options: q.options.map((opt, oi) => `(${letterOf(oi)})${opt}`),
    answer: letterOf(q.correctIndex),
    explanation: explanations[i] ?? '',
  }));

  return NextResponse.json({
    title: '題庫匯入測驗',
    questions: outQuestions,
    parseReport: {
      total: questions.length,
      imported: outQuestions.length,
      failed: failedSegments,
      truncated,
    },
  });
}
