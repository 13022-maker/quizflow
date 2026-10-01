// 協作批閱「共創產出型態」：free_text（原始做法，自由文字）／question（小組出一道題目）
// 純函式模組，server（送出驗證、匯入題庫）與 client（編輯器、預覽、編輯頁下拉選單）共用。
import { z } from 'zod';

import type { ReviewCreateMode } from './modes/types';

export type CreateModeInfo = {
  mode: ReviewCreateMode;
  label: string;
  description: string;
};

const CREATE_MODES: CreateModeInfo[] = [
  { mode: 'free_text', label: '自由文字創作', description: '小組共同寫出一份延伸創作答案' },
  {
    mode: 'question',
    label: '小組出一道題目',
    description: '小組共同出一道單選／複選／是非題（含正確答案與解析），全班投票選出最好的題目，老師可一鍵匯入自己的測驗',
  },
];

export function listCreateModes(): CreateModeInfo[] {
  return CREATE_MODES;
}

/** 建立/編輯題組時檢查此共創型態可否使用；可用回 null，否則回傳繁中錯誤訊息 */
export function validateCreateModeSet(_mode: ReviewCreateMode): string | null {
  return null;
}

// ---------- question 型態：小組出的一道題目 ----------
// 草稿（review_draft.content）與小組答案（review_submission.content）都存這個物件的 JSON 字串，
// 不另開欄位。是非題選項 id 比照既有題庫（QuestionForm / questionRows）固定 tf-true / tf-false。

export type CreatedQuestionType = 'single_choice' | 'multiple_choice' | 'true_false';

export type CreatedQuestion = {
  type: CreatedQuestionType;
  body: string; // 1–500 字
  options: { id: string; text: string }[]; // 單/複選 2–6 項；是非固定 tf-true / tf-false
  correctAnswers: string[]; // option id；單選/是非剛好 1 個，複選 ≥1 個
  explanation?: string; // 0–500 字
};

export const CREATED_QUESTION_TYPE_LABEL: Record<CreatedQuestionType, string> = {
  single_choice: '單選題',
  multiple_choice: '複選題',
  true_false: '是非題',
};

export const TRUE_FALSE_OPTIONS: readonly { id: string; text: string }[] = [
  { id: 'tf-true', text: '正確' },
  { id: 'tf-false', text: '錯誤' },
];

export const CREATED_QUESTION_LIMITS = {
  bodyMax: 500,
  optionMin: 2,
  optionMax: 6,
  optionTextMax: 200,
  explanationMax: 500,
} as const;

// 選項 id 用 a–f（與 bloomActions / questionRows 匯入題目時的慣例一致），最多 6 個剛好用完
const OPTION_IDS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
const FORMAT_ERROR = '題目格式錯誤，請重新編輯';
const TYPE_VALUES = ['single_choice', 'multiple_choice', 'true_false'] as const;

const L = CREATED_QUESTION_LIMITS;

export const CreatedQuestionSchema = z
  .object({
    type: z.enum(TYPE_VALUES, { errorMap: () => ({ message: '題型只能是單選、複選或是非' }) }),
    body: z.string().trim().min(1, '請輸入題幹').max(L.bodyMax, `題幹最多 ${L.bodyMax} 字`),
    options: z
      .array(z.object({
        id: z.string().min(1, FORMAT_ERROR),
        text: z.string().trim().min(1, '選項內容不能空白').max(L.optionTextMax, `每個選項最多 ${L.optionTextMax} 字`),
      }))
      .min(L.optionMin, `選項需要 ${L.optionMin} 到 ${L.optionMax} 個`)
      .max(L.optionMax, `選項需要 ${L.optionMin} 到 ${L.optionMax} 個`),
    correctAnswers: z.array(z.string()),
    explanation: z.string().trim().max(L.explanationMax, `解析最多 ${L.explanationMax} 字`).optional(),
  })
  .superRefine((q, ctx) => {
    // 依優先順序只回報第一個問題，讓學生一次修一件事
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    const optionIds = q.options.map(o => o.id);
    if (new Set(optionIds).size !== optionIds.length) {
      return fail('選項代號重複，請重新編輯');
    }
    if (q.type === 'true_false') {
      const ids = new Set(optionIds);
      if (ids.size !== 2 || !ids.has('tf-true') || !ids.has('tf-false')) {
        return fail('是非題選項必須是「正確」與「錯誤」');
      }
    }
    if (new Set(q.correctAnswers).size !== q.correctAnswers.length) {
      return fail('正確答案重複');
    }
    if (q.correctAnswers.some(id => !optionIds.includes(id))) {
      return fail('正確答案必須是現有的選項');
    }
    if (q.correctAnswers.length === 0) {
      return fail(q.type === 'multiple_choice' ? '正確答案至少要選 1 個' : '請選擇正確答案');
    }
    if (q.type !== 'multiple_choice' && q.correctAnswers.length > 1) {
      return fail(q.type === 'single_choice' ? '單選題只能有 1 個正確答案' : '是非題只能有 1 個正確答案');
    }
    return undefined;
  })
  // 是非題選項文字一律正規化成標準「正確／錯誤」，避免 client 竄改顯示文字
  .transform((q): CreatedQuestion => (q.type === 'true_false'
    ? { ...q, options: TRUE_FALSE_OPTIONS.map(o => ({ ...o })) }
    : q));

function safeJsonParse(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type ParseResult = { ok: true; question: CreatedQuestion } | { ok: false; error: string };

function parseWithError(content: string): ParseResult {
  if (content.trim().length === 0) {
    return { ok: false, error: '請先完成題目再送出' };
  }
  const raw = safeJsonParse(content);
  if (!isPlainObject(raw)) {
    return { ok: false, error: FORMAT_ERROR };
  }
  const parsed = CreatedQuestionSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, question: parsed.data };
  }
  const issue = parsed.error.issues[0];
  // 欄位型別錯亂（例如 body 是數字）的 zod 預設訊息是英文，統一換成繁中格式錯誤
  const message = !issue || issue.code === 'invalid_type' ? FORMAT_ERROR : issue.message;
  return { ok: false, error: message };
}

/** 嚴格 parse：JSON 壞掉或題目不合法回 null（送出、投票、匯入題庫用） */
export function parseCreatedQuestion(content: string): CreatedQuestion | null {
  const result = parseWithError(content);
  return result.ok ? result.question : null;
}

/**
 * 寬鬆 parse：給編輯器與「未完成」預覽讀半成品。不驗證、不去空白，型別不對的欄位丟掉補預設；
 * 連物件都不是（空字串、壞 JSON、舊的自由文字）才回 null。explanation 一律補成字串。
 */
export function parseCreatedQuestionDraft(content: string): CreatedQuestion & { explanation: string } | null {
  const raw = safeJsonParse(content);
  if (!isPlainObject(raw)) {
    return null;
  }
  const type = (TYPE_VALUES as readonly unknown[]).includes(raw.type) ? raw.type as CreatedQuestionType : 'single_choice';
  const options = Array.isArray(raw.options)
    ? raw.options
      .filter((o): o is { id: string; text: string } =>
        isPlainObject(o) && typeof o.id === 'string' && typeof o.text === 'string')
      .map(o => ({ id: o.id, text: o.text }))
    : [];
  const correctAnswers = Array.isArray(raw.correctAnswers)
    ? raw.correctAnswers.filter((id): id is string => typeof id === 'string')
    : [];
  return {
    type,
    body: typeof raw.body === 'string' ? raw.body : '',
    options,
    correctAnswers,
    explanation: typeof raw.explanation === 'string' ? raw.explanation : '',
  };
}

export function serializeCreatedQuestion(q: CreatedQuestion): string {
  return JSON.stringify(q);
}

function blankChoiceOptions(): { id: string; text: string }[] {
  return OPTION_IDS.slice(0, 4).map(id => ({ id, text: '' }));
}

/** 編輯器初始值：單/複選 4 個空白選項，是非固定兩項；正確答案皆未選 */
export function emptyCreatedQuestion(type: CreatedQuestionType): CreatedQuestion & { explanation: string } {
  return {
    type,
    body: '',
    options: type === 'true_false' ? TRUE_FALSE_OPTIONS.map(o => ({ ...o })) : blankChoiceOptions(),
    correctAnswers: [],
    explanation: '',
  };
}

/** 編輯器切換題型：盡量保留已寫的內容（題幹、解析、單複選之間的選項） */
export function switchCreatedQuestionType<Q extends CreatedQuestion>(q: Q, nextType: CreatedQuestionType): Q {
  if (q.type === nextType) {
    return q;
  }
  if (nextType === 'true_false') {
    return { ...q, type: nextType, options: TRUE_FALSE_OPTIONS.map(o => ({ ...o })), correctAnswers: [] };
  }
  if (q.type === 'true_false') {
    return { ...q, type: nextType, options: blankChoiceOptions(), correctAnswers: [] };
  }
  return {
    ...q,
    type: nextType,
    correctAnswers: nextType === 'single_choice' ? q.correctAnswers.slice(0, 1) : q.correctAnswers,
  };
}

/** 新增選項時挑第一個還沒用過的 id（a–f）；已滿 6 個回 null */
export function nextOptionId(options: { id: string }[]): string | null {
  const used = new Set(options.map(o => o.id));
  return OPTION_IDS.find(id => !used.has(id)) ?? null;
}

/**
 * 匯入正式題庫時的 question 表欄位（points / position 規則比照 questionActions.createQuestion：
 * 預設 1 分、position 由呼叫端算好接在最後）。
 */
export function buildQuestionInsertFromCreated(q: CreatedQuestion, quizId: number, position: number) {
  return {
    quizId,
    type: q.type,
    body: q.body,
    options: q.type === 'true_false' ? TRUE_FALSE_OPTIONS.map(o => ({ ...o })) : q.options,
    correctAnswers: q.correctAnswers,
    explanation: q.explanation?.trim() ? q.explanation : null,
    points: 1,
    position,
  };
}

// ---------- 各共創型態共用入口 ----------

/**
 * 隊長正式送出前驗證內容格式。free_text 不限制（空字串由既有流程處理）；
 * 回傳 null 代表通過，否則回傳繁中錯誤訊息。
 */
export function validateCreateContent(mode: ReviewCreateMode, content: string): string | null {
  if (mode === 'free_text') {
    return null;
  }
  const result = parseWithError(content);
  return result.ok ? null : result.error;
}

/**
 * 投票階段是否列為候選。question 型態只列「完整合法」的題目：系統逾時代送的半成品
 * 沒有正確答案或選項，拿來比「誰的題目最好」沒有意義，也無法匯入題庫。
 */
export function isVotableCreateContent(mode: ReviewCreateMode, content: string): boolean {
  if (mode === 'free_text') {
    return content.trim().length > 0;
  }
  return parseCreatedQuestion(content) !== null;
}

/**
 * 貢獻度字數。question 型態只算學生實際打的字（題幹＋選項＋解析），避免 JSON 結構灌水；
 * 是非題固定選項不算。不是 JSON 物件（壞掉或舊的自由文字草稿）就退回原始字串長度。
 */
export function countCreateContentChars(mode: ReviewCreateMode, content: string): number {
  if (mode === 'free_text') {
    return content.length;
  }
  const q = parseCreatedQuestionDraft(content);
  if (!q) {
    return content.length;
  }
  const optionChars = q.type === 'true_false' ? 0 : q.options.reduce((sum, o) => sum + o.text.length, 0);
  return q.body.length + optionChars + q.explanation.length;
}
