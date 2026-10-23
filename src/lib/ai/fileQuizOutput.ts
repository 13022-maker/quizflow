/**
 * fileQuizOutput.ts — generate-from-file（檔案出題）的 AI 輸出檢查與錯誤訊息對應
 *
 * 純函式，抽出來才能單元測試（API Route 本身不方便測）：
 * - finishReason / stop_reason → 老師看得懂的訊息（過去 Gemini 的 SAFETY / RECITATION
 *   全被當成「GEMINI_TRUNCATED」sentinel，還直接顯示「AI 命題失敗：GEMINI_TRUNCATED」）
 * - 題目驗證：剔除缺題幹／選項不足／缺答案的題目，選擇題答案正規化成單一字母
 * - types 欄位解析：過去 JSON.parse 在 try 外面，格式錯誤直接 500
 */
import { z } from 'zod';

import { stripOptionLabel } from './optionText';

export const TRUNCATED_MESSAGE = '題數太多，AI 輸出被截斷，請減少題型或每種題數後再試';
export const RECITATION_MESSAGE = 'AI 偵測到大量照抄原文，請改出理解型題目或縮小頁數範圍';
export const SAFETY_MESSAGE = '內容觸發安全過濾，請更換頁面範圍';
export const OTHER_OUTPUT_MESSAGE = 'AI 輸出異常中斷，請稍後再試';
export const EMPTY_CONTENT_MESSAGE = '這幾頁內容不足以出題（可能是空白或掃描不清），請換頁面範圍';

export type AIOutputErrorKind = 'truncated' | 'recitation' | 'safety' | 'other';

/** AI 有回應但輸出不可用（截斷、照抄、安全過濾）。userMessage 可直接給老師看 */
export class AIOutputError extends Error {
  readonly kind: AIOutputErrorKind;
  readonly userMessage: string;
  readonly rawReason: string;

  constructor(kind: AIOutputErrorKind, rawReason: string) {
    const userMessage = {
      truncated: TRUNCATED_MESSAGE,
      recitation: RECITATION_MESSAGE,
      safety: SAFETY_MESSAGE,
      other: OTHER_OUTPUT_MESSAGE,
    }[kind];
    super(userMessage);
    this.name = 'AIOutputError';
    this.kind = kind;
    this.userMessage = userMessage;
    this.rawReason = rawReason;
  }
}

const GEMINI_SAFETY_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY']);

/** Gemini candidates[0].finishReason → 錯誤（STOP / 未提供回 null） */
export function geminiFinishReasonError(finishReason: string | undefined | null): AIOutputError | null {
  if (!finishReason || finishReason === 'STOP') {
    return null;
  }
  if (finishReason === 'MAX_TOKENS') {
    return new AIOutputError('truncated', finishReason);
  }
  if (finishReason === 'RECITATION') {
    return new AIOutputError('recitation', finishReason);
  }
  if (GEMINI_SAFETY_REASONS.has(finishReason)) {
    return new AIOutputError('safety', finishReason);
  }
  return new AIOutputError('other', finishReason);
}

/** Claude message.stop_reason → 錯誤（正常結束回 null） */
export function claudeStopReasonError(stopReason: string | undefined | null): AIOutputError | null {
  if (stopReason === 'max_tokens') {
    return new AIOutputError('truncated', stopReason);
  }
  if (stopReason === 'refusal') {
    return new AIOutputError('safety', stopReason);
  }
  return null;
}

// ---------- types 欄位 ----------

export const FILE_QUESTION_TYPES = ['mc', 'tf', 'fill', 'short', 'rank', 'cloze', 'listening'] as const;
type FileType = (typeof FILE_QUESTION_TYPES)[number];

const typesSchema = z.array(z.enum(FILE_QUESTION_TYPES)).min(1);

export function parseTypesField(
  raw: string | null | undefined,
): { ok: true; types: FileType[] } | { ok: false; error: string } {
  if (!raw) {
    return { ok: true, types: ['mc'] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: '題型參數格式錯誤，請重新選擇題型後再試' };
  }
  const result = typesSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: '題型參數格式錯誤，請重新選擇題型後再試' };
  }
  return { ok: true, types: result.data };
}

// ---------- 題目驗證 ----------

const MC_ANSWER_RE = /^[（(]?([A-D])[)）.．]?$/i;

/** 「(A)」「A.」「（B）」「c」→ 大寫字母；不是單一 A–D 字母回 null */
export function normalizeMcAnswer(answer: string): string | null {
  const m = answer.trim().match(MC_ANSWER_RE);
  return m ? m[1]!.toUpperCase() : null;
}

const nonEmptyString = z.string().refine(s => s.trim().length > 0);

// passthrough：保留 explanation / listeningText / diagram 等額外欄位，回應形狀不變
const baseSchema = z.object({ question: nonEmptyString }).passthrough();
const optionsSchema = z.array(z.string()).min(2).refine(
  opts => opts.every(o => stripOptionLabel(o).trim().length > 0),
);

const questionSchema = z.discriminatedUnion('type', [
  baseSchema.extend({ type: z.literal('mc'), options: optionsSchema, answer: nonEmptyString }),
  baseSchema.extend({ type: z.literal('listening'), options: optionsSchema, answer: nonEmptyString }),
  baseSchema.extend({ type: z.literal('tf'), answer: nonEmptyString }),
  baseSchema.extend({ type: z.literal('fill'), answer: nonEmptyString }),
  baseSchema.extend({ type: z.literal('short'), answer: nonEmptyString }),
  baseSchema.extend({ type: z.literal('rank'), options: optionsSchema, answer: z.array(z.string()).optional() }),
  baseSchema.extend({ type: z.literal('cloze') }),
]);

export type ValidatedQuestion = z.infer<typeof questionSchema>;

/**
 * 剔除不完整的題目並正規化選擇題答案。
 * 選擇題答案若是字母（各種括號寫法）→ 轉成大寫字母，且必須落在選項範圍內；
 * 若是選項文字本身 → 必須對得到某個選項（questionRows 會用文字比對存正解），否則丟棄。
 */
export function validateGeneratedQuestions(
  input: unknown[],
): { questions: ValidatedQuestion[]; dropped: number } {
  const questions: ValidatedQuestion[] = [];
  let dropped = 0;

  for (const item of input) {
    const parsed = questionSchema.safeParse(item);
    if (!parsed.success) {
      dropped++;
      continue;
    }
    const q = parsed.data;
    if (q.type === 'mc' || q.type === 'listening') {
      const letter = normalizeMcAnswer(q.answer);
      if (letter) {
        if (letter.charCodeAt(0) - 65 >= q.options.length) {
          dropped++;
          continue;
        }
        questions.push({ ...q, answer: letter });
        continue;
      }
      const answerText = stripOptionLabel(q.answer).trim();
      if (!q.options.some(o => stripOptionLabel(o).trim() === answerText)) {
        dropped++;
        continue;
      }
    }
    questions.push(q);
  }

  return { questions, dropped };
}
