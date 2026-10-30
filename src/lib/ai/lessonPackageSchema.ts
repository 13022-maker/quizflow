// 老師貼進 /dashboard/import 的「備課包」JSON 結構驗證。
// 對應 docs/prompts/lesson-prep-assistant.md 產出的格式，
// 題目欄位跟 src/lib/quiz/questionRows.ts 的 GeneratedQuestion 對齊（同一套匯入邏輯共用）。
import { z } from 'zod';

import { stripOptionLabel } from '@/lib/ai/optionText';
import { matchChoiceAnswerId, parseTrueFalseAnswer } from '@/lib/quiz/answerNormalize';

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

  if (q.type === 'mc' || q.type === 'listening') {
    if (!q.options || q.options.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${q.type} 題型的 options 至少要有 2 個選項`,
        path: ['options'],
      });
    } else {
      // 跟 src/lib/quiz/questionRows.ts 的 buildQuestionInsertRows 用同一個 matchChoiceAnswerId，
      // 避免驗證邏輯跟實際匯入邏輯兜不起來
      const options = q.options.map((text, i) => ({
        id: String.fromCharCode(97 + i),
        text: stripOptionLabel(text),
      }));
      const matchedId = matchChoiceAnswerId(options, q.answer);

      if (!matchedId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${q.type} 題型的 answer 必須對應到其中一個選項（選項文字或字母 A/B/C...）`,
          path: ['answer'],
        });
      }
    }
  }

  if (q.type === 'tf' && typeof q.answer === 'string' && q.answer.trim() && !parseTrueFalseAnswer(q.answer)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'tf 題型的 answer 必須是「正確」或「錯誤」',
      path: ['answer'],
    });
  }

  if (q.type === 'tf' || q.type === 'short' || q.type === 'fill') {
    const ansStr = typeof q.answer === 'string' ? q.answer.trim() : '';
    if (!ansStr) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${q.type} 題型的 answer 不可為空`,
        path: ['answer'],
      });
    }
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
