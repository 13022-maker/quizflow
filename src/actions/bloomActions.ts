'use server';

import { auth } from '@clerk/nextjs/server';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { questionSchema, quizSchema } from '@/models/Schema';

// Bloom API 回傳的題目格式
export type BloomQuestion = {
  id: number;
  type: 'multiple_choice' | 'short_answer';
  bloom_level: string;
  difficulty: number;
  content: string;
  options?: string[];
  correct_answer: number | string;
  explanation: string;
  learning_objective: string;
  estimated_time_minutes?: number;
};

// 生成 6 碼大寫英數房間碼
function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Bloom 題型 → QuizFlow 題型映射
function toQuizFlowType(bloomType: BloomQuestion['type']): 'single_choice' | 'short_answer' {
  if (bloomType === 'short_answer') return 'short_answer';
  return 'single_choice';
}

// 選項陣列轉 QuizFlow options 格式（選項 id = a/b/c/d）
function buildOptions(opts: string[]): { id: string; text: string }[] {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  return opts.map((text, i) => ({ id: ids[i] ?? String(i), text }));
}

// correct_answer（索引）→ correctAnswers（id 陣列）
function buildCorrectAnswers(question: BloomQuestion): string[] {
  if (question.type === 'short_answer') return [];
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const idx = typeof question.correct_answer === 'number' ? question.correct_answer : 0;
  return [ids[idx] ?? 'a'];
}

const TitleSchema = z.string().min(1, '請輸入測驗標題').max(200);

// 批次建立測驗 + 匯入 Bloom 格式題目
export async function createQuizWithBloomQuestions(
  title: string,
  questions: BloomQuestion[],
): Promise<{ quizId: number } | { error: string }> {
  const { userId } = await auth();
  if (!userId) return { error: '未登入' };

  const titleResult = TitleSchema.safeParse(title);
  if (!titleResult.success) {
    return { error: titleResult.error.errors[0]?.message ?? '標題格式錯誤' };
  }

  // 建立測驗
  const [inserted] = await db
    .insert(quizSchema)
    .values({
      title: titleResult.data,
      ownerId: userId,
      accessCode: nanoid(8),
      roomCode: generateRoomCode(),
    })
    .returning();

  if (!inserted) return { error: '建立測驗失敗' };

  const quizId = inserted.id;

  // 批次插入題目
  if (questions.length > 0) {
    await db.insert(questionSchema).values(
      questions.map((q, i) => {
        const qfType = toQuizFlowType(q.type);
        const options = q.options ? buildOptions(q.options) : null;
        const correctAnswers = q.type !== 'short_answer' ? buildCorrectAnswers(q) : null;

        return {
          quizId,
          type: qfType,
          body: q.content,
          options,
          correctAnswers,
          referenceAnswer: q.type === 'short_answer'
            ? (typeof q.correct_answer === 'string' ? q.correct_answer : null)
            : null,
          points: 1,
          position: i + 1,
        };
      }),
    );
  }

  return { quizId };
}
