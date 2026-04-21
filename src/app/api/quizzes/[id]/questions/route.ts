import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { questionSchema, quizSchema } from '@/models/Schema';

// 依 CLAUDE.md 規範：所有 API Route 最頂端加 runtime = 'nodejs'
// 避免被誤判為 Edge runtime（drizzle pg driver 與 Clerk auth 需要 Node API）
export const runtime = 'nodejs';

// AIQuizModal 回傳的題目格式
type FileQuestionType = 'mc' | 'tf' | 'fill' | 'short' | 'rank' | 'listening';
type GeneratedQuestion = {
  type: FileQuestionType;
  question: string;
  options?: string[];
  answer: string | string[];
  explanation?: string;
  listeningText?: string; // 聽力題要念的口語化文字
  audioUrl?: string; // 聽力題已生成的音檔 URL
};

// 題型對應：AIQuizModal → DB enum
const DB_TYPE_MAP: Record<FileQuestionType, string> = {
  mc: 'single_choice',
  tf: 'true_false',
  fill: 'short_answer',
  short: 'short_answer',
  rank: 'ranking',
  listening: 'listening',
};

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  // 驗證登入，批次匯入需要 orgId 才能確認測驗所有權
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  const quizId = Number(params.id);
  if (Number.isNaN(quizId)) {
    return NextResponse.json({ error: '無效的測驗 ID' }, { status: 400 });
  }

  // 驗證測驗所有權：先撈 quiz 本身，再比 ownerId。
  // 分開檢查是因為 preview 環境實際遇到「page SSR 查得到、API 卻 404」的詭異情況，
  // 用這個切法能讓 Vercel function log 明確區分「測驗不存在」與「ownership 不符」。
  const [quiz] = await db
    .select({ id: quizSchema.id, ownerId: quizSchema.ownerId })
    .from(quizSchema)
    .where(eq(quizSchema.id, quizId))
    .limit(1);

  if (!quiz) {
    console.warn('[api/quizzes/questions POST] quiz not found', { quizId, orgId });
    return NextResponse.json({ error: '找不到測驗' }, { status: 404 });
  }
  if (quiz.ownerId !== orgId) {
    console.warn('[api/quizzes/questions POST] ownership mismatch', {
      quizId,
      sessionOrgId: orgId,
      quizOwnerId: quiz.ownerId,
    });
    return NextResponse.json({ error: '無權限操作此測驗' }, { status: 403 });
  }

  const body = await request.json();
  const questions: GeneratedQuestion[] = body.questions ?? [];

  if (!questions.length) {
    return NextResponse.json({ error: '沒有題目可匯入' }, { status: 400 });
  }

  // 取得目前最大 position，讓新題目接在現有題目後面
  const existing = await db
    .select({ position: questionSchema.position })
    .from(questionSchema)
    .where(eq(questionSchema.quizId, quizId));

  let nextPosition
    = existing.length > 0
      ? Math.max(...existing.map(q => q.position)) + 1
      : 1;

  // 將 AIQuizModal 格式轉換為 DB 格式，批次組成 rows
  const rows = questions.map((q) => {
    const type = (DB_TYPE_MAP[q.type] ?? 'short_answer') as typeof questionSchema.$inferInsert.type;
    let options: { id: string; text: string }[] | null = null;
    let correctAnswers: string[] = [];

    if ((q.type === 'mc' || q.type === 'listening') && q.options?.length) {
      // 選擇題：將 string[] 轉成 { id, text }[]
      options = q.options.map((text, i) => ({
        id: String.fromCharCode(97 + i), // a, b, c, d
        text,
      }));
      // answer 可能是 "A"/"B" 大寫字母，或選項文字本身
      const ansStr = typeof q.answer === 'string' ? q.answer : '';
      const answerKey = ansStr.trim().toLowerCase();
      const byLetter = options.find(o => o.id === answerKey);
      const byText = options.find(o => o.text === ansStr);
      const matched = byLetter ?? byText;
      correctAnswers = matched ? [matched.id] : [];
    } else if (q.type === 'rank' && q.options?.length) {
      // 排序題：每個選項配 id，correctAnswers 為依 q.answer 文字順序對映的 id 陣列
      options = q.options.map((text, i) => ({
        id: String.fromCharCode(97 + i),
        text,
      }));
      const answerArr = Array.isArray(q.answer) ? q.answer : [];
      correctAnswers = answerArr
        .map(ansText => options!.find(o => o.text === ansText)?.id)
        .filter((id): id is string => Boolean(id));
      // AI 幻覺保險：若對映失敗，回退到輸入順序當正解
      if (correctAnswers.length !== options.length) {
        correctAnswers = options.map(o => o.id);
      }
    } else if (q.type === 'tf') {
      // 是非題：將 AI 回傳的 ○/✕ 轉換為標準選項 ID
      options = [
        { id: 'tf-true', text: '正確' },
        { id: 'tf-false', text: '錯誤' },
      ];
      const ansStr = typeof q.answer === 'string' ? q.answer.trim() : '';
      const isTrue = ansStr === '○' || ansStr === 'O' || ansStr.toLowerCase() === 'true' || ansStr === '正確';
      correctAnswers = [isTrue ? 'tf-true' : 'tf-false'];
    } else {
      // 填空 / 簡答：直接存 answer 字串
      const ansStr = typeof q.answer === 'string' ? q.answer : '';
      correctAnswers = ansStr ? [ansStr] : [];
    }

    return {
      quizId,
      type,
      body: q.question,
      options,
      correctAnswers: correctAnswers.length ? correctAnswers : null,
      audioUrl: q.audioUrl || null,
      audioTranscript: q.listeningText || null,
      points: 1,
      position: nextPosition++,
    };
  });

  // 一次批次插入，減少 DB round-trip
  await db.insert(questionSchema).values(rows);

  // 必須 revalidate，否則編輯頁 server component 即使 router.refresh()
  // 也可能拿到快取中的舊題目列表，前端顯示「題目 (0)」
  revalidatePath(`/dashboard/quizzes/${quizId}/edit`);

  return NextResponse.json({ count: rows.length });
}
