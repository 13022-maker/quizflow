// 老師貼進 /dashboard/import 的「備課包」JSON 結構驗證。
// 對應 docs/prompts/lesson-prep-assistant.md 產出的格式，
// 題目欄位跟 src/lib/quiz/questionRows.ts 的 GeneratedQuestion 對齊（同一套匯入邏輯共用）。
import { z } from 'zod';

const questionTypeValues = ['mc', 'tf', 'fill', 'short', 'rank', 'listening', 'cloze'] as const;

const CLOZE_MARKER_REGEX = /\[\[[^[\]]+\]\]/;

const baseQuestionSchema = z.object({
  type: z.enum(questionTypeValues),
  question: z.string().min(1, '題目內容不可為空'),
  options: z.array(z.string()).optional(),
  answer: z.union([z.string(), z.array(z.string())]).optional(),
  explanation: z.string().optional(),
  listeningText: z.string().optional(),
  audioUrl: z.string().optional(),
  audioDurationSec: z.number().optional(),
  imageUrl: z.string().optional(),
  diagramSvg: z.string().optional(),
});

export const lessonPackageQuestionSchema = baseQuestionSchema.superRefine((q, ctx) => {
  if (q.type === 'rank') {
    if (!Array.isArray(q.answer)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'rank 題型的 answer 必須是陣列',
        path: ['answer'],
      });
    } else if (!q.options || q.answer.length !== q.options.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'rank 題型的 answer 陣列長度必須跟 options 一致',
        path: ['answer'],
      });
    }
  }

  if (q.type === 'cloze' && !CLOZE_MARKER_REGEX.test(q.question)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'cloze 題型的 question 必須至少包含一組 [[ ]] 標記',
      path: ['question'],
    });
  }
});

export type LessonPackageQuestion = z.infer<typeof baseQuestionSchema>;

const quizEntrySchema = z.object({
  stage: z.string().optional(),
  title: z.string().min(1, '測驗標題不可為空'),
  questions: z.array(lessonPackageQuestionSchema).min(1, '每份測驗至少要有一題'),
});

const flashcardSchema = z.object({
  front: z.string().min(1, '單字卡正面不可為空'),
  back: z.string().min(1, '單字卡背面不可為空'),
  example: z.string().optional(),
});

const flashcardSetSchema = z.object({
  title: z.string().min(1, '單字卡集標題不可為空'),
  cards: z.array(flashcardSchema).min(1, '單字卡集至少要有一張卡'),
});

const teacherNotesSchema = z.object({
  flow: z.string().optional(),
  misconceptions: z.array(z.string()).optional(),
  afterClass: z.string().optional(),
});

export const lessonPackageSchema = z.object({
  quizzes: z.array(quizEntrySchema).min(1, '至少要有一份測驗'),
  flashcards: flashcardSetSchema,
  teacherNotes: teacherNotesSchema,
});

export type LessonPackage = z.infer<typeof lessonPackageSchema>;

/** 把 ZodError 轉成適合直接顯示給老師看的 { path, message } 清單 */
export function formatLessonPackageErrors(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map(issue => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}
