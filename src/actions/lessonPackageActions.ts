'use server';

import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';

import { checkAndIncrementAiUsage } from '@/actions/aiUsageActions';
import { formatLessonPackageErrors, lessonPackageSchema } from '@/lib/ai/lessonPackageSchema';
import { buildQuestionInsertRows } from '@/lib/quiz/questionRows';
import { db } from '@/libs/DB';
import { isProOrAbove } from '@/libs/Plan';
import { questionSchema, quizSchema, vocabCardSchema, vocabSetSchema } from '@/models/Schema';

// 6 碼大寫英數房間碼；邏輯跟 src/actions/quizActions.ts 的 generateRoomCode 一致。
// 獨立複製一份而不是 import quizActions（避免匯入一支帶 CreateQuizSchema/redirect 的
// 'use server' 檔案，多拉不需要的相依）；未來若第三處要用再抽到共用 lib。
function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function generateUniqueRoomCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    const [existing] = await db
      .select({ id: quizSchema.id })
      .from(quizSchema)
      .where(eq(quizSchema.roomCode, code))
      .limit(1);
    if (!existing) {
      return code;
    }
  }
  return generateRoomCode() + generateRoomCode().slice(0, 1);
}

export type ImportLessonPackageResult =
  | {
    quizzes: { id: number; title: string }[];
    vocabSetId: number;
    vocabTitle: string;
    teacherNotes: { flow?: string; misconceptions?: string[]; afterClass?: string };
  }
  | { error: string; detail?: { path: string; message: string }[] };

export async function importLessonPackage(rawJson: string): Promise<ImportLessonPackageResult> {
  const { userId } = await auth();
  if (!userId) {
    return { error: '未登入' };
  }

  if (!(await isProOrAbove(userId))) {
    return { error: 'PRO_REQUIRED' };
  }

  const quota = await checkAndIncrementAiUsage(userId);
  if (!quota.allowed) {
    return { error: 'QUOTA_EXCEEDED' };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawJson);
  } catch (err) {
    return { error: `JSON 格式錯誤：${err instanceof Error ? err.message : '無法解析'}` };
  }

  const parsed = lessonPackageSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { error: '備課包內容格式不正確', detail: formatLessonPackageErrors(parsed.error) };
  }

  const pkg = parsed.data;

  // 先在 transaction 外準備好每份測驗要用的房間碼/access code（跟 src/libs/fork-dao.ts
  // 的慣例一致：唯一性檢查用一般查詢，不需要放進 transaction 裡）
  const quizCodes: { roomCode: string; accessCode: string }[] = [];
  for (let i = 0; i < pkg.quizzes.length; i++) {
    quizCodes.push({ roomCode: await generateUniqueRoomCode(), accessCode: nanoid(8) });
  }

  let created;
  try {
    created = await db.transaction(async (tx) => {
      const createdQuizzes: { id: number; title: string }[] = [];

      for (let i = 0; i < pkg.quizzes.length; i++) {
        const quizEntry = pkg.quizzes[i]!;
        const codes = quizCodes[i]!;

        const [insertedQuiz] = await tx
          .insert(quizSchema)
          .values({
            ownerId: userId,
            title: quizEntry.title,
            accessCode: codes.accessCode,
            roomCode: codes.roomCode,
            quizMode: 'standard',
          })
          .returning();

        if (!insertedQuiz) {
          throw new Error('建立測驗失敗');
        }

        const rows = buildQuestionInsertRows(quizEntry.questions, insertedQuiz.id, 1);
        await tx.insert(questionSchema).values(rows);

        createdQuizzes.push({ id: insertedQuiz.id, title: insertedQuiz.title });
      }

      const [insertedVocabSet] = await tx
        .insert(vocabSetSchema)
        .values({
          ownerId: userId,
          title: pkg.flashcards.title,
          accessCode: nanoid(8),
          status: 'published',
        })
        .returning();

      if (!insertedVocabSet) {
        throw new Error('建立單字卡集失敗');
      }

      await tx.insert(vocabCardSchema).values(
        pkg.flashcards.cards.map((card, i) => ({
          setId: insertedVocabSet.id,
          front: card.front,
          back: card.back,
          example: card.example ?? null,
          position: i,
        })),
      );

      return {
        quizzes: createdQuizzes,
        vocabSetId: insertedVocabSet.id,
        vocabTitle: insertedVocabSet.title,
      };
    });
  } catch (err) {
    console.error('[importLessonPackage] transaction failed', err);
    return { error: '匯入失敗，請重試' };
  }

  revalidatePath('/dashboard/quizzes');
  revalidatePath('/dashboard/vocab');

  return {
    ...created,
    teacherNotes: pkg.teacherNotes,
  };
}
