/**
 * 靜態練習頁（/api/p/[id]）匿名作答事件的輸入驗證。
 *
 * 純函式：不碰 DB、不碰 Request，方便測試；由 api/p/[id]/events/route.ts 呼叫。
 * 練習頁是公開免登入頁面，所有欄位都當不可信輸入處理：
 * 白名單 type、大小上限、數值夾限、字串截斷，email 另外要求明確同意。
 * 不收任何可識別個人的資訊（姓名/學校/電話/IP），email 為使用者主動填寫且勾選同意。
 */
import { z } from 'zod';

export const MAX_EVENT_BODY_BYTES = 4096;
// 單題停留時間上限 30 分鐘：超過多半是分頁放著沒關，夾到上限避免拉歪平均
export const MAX_MS_ON_QUESTION = 30 * 60 * 1000;
// 單一 session 最多收幾筆事件（含 session_start/answer/complete/profile），超過靜默忽略
export const MAX_EVENTS_PER_SESSION = 300;
// 題號上限：練習頁一份不會超過這麼多題，防止灌爆 index
const MAX_QUESTION_INDEX = 999;

export const PROFILE_ROLES = ['junior_high', 'senior_high', 'college', 'teacher', 'parent', 'other'] as const;
export const PROFILE_LANGUAGES = ['cpp', 'python'] as const;
export const PROFILE_EXAM_PLANS = ['soon', 'later', 'none', 'taken'] as const;

// 畫面顯示用的中文標籤（練習頁內嵌 JS 與老師統計頁共用）
export const PROFILE_ROLE_LABELS: Record<(typeof PROFILE_ROLES)[number], string> = {
  junior_high: '國中',
  senior_high: '高中',
  college: '大學',
  teacher: '老師',
  parent: '家長',
  other: '其他',
};
export const PROFILE_LANGUAGE_LABELS: Record<(typeof PROFILE_LANGUAGES)[number], string> = {
  cpp: 'C++',
  python: 'Python',
};
export const PROFILE_EXAM_PLAN_LABELS: Record<(typeof PROFILE_EXAM_PLANS)[number], string> = {
  soon: '近期一場',
  later: '之後',
  none: '不考',
  taken: '已考過',
};

// 字串欄位：非字串或空字串一律當 null，過長截斷（不拒絕整筆，分析資料寧可收殘缺的）
const shortText = z
  .unknown()
  .transform((v) => {
    if (typeof v !== 'string') {
      return null;
    }
    const trimmed = v.trim();
    return trimmed ? trimmed.slice(0, 100) : null;
  });

// 只收主機名稱（例：m.youtube.com），帶路徑/查詢字串/怪字元一律當 null
const referrerHost = z.unknown().transform((v) => {
  if (typeof v !== 'string') {
    return null;
  }
  const host = v.trim().toLowerCase();
  return /^[a-z0-9.-]{1,253}$/.test(host) ? host : null;
});

const sessionId = z.string().uuid();

const sessionStartSchema = z.object({
  type: z.literal('session_start'),
  sessionId,
  utmSource: shortText.optional().transform(v => v ?? null),
  utmContent: shortText.optional().transform(v => v ?? null),
  utmCampaign: shortText.optional().transform(v => v ?? null),
  referrerHost: referrerHost.optional().transform(v => v ?? null),
  deviceType: z.enum(['mobile', 'desktop']),
});

const answerSchema = z.object({
  type: z.literal('answer'),
  sessionId,
  questionIndex: z.number().int().min(0).max(MAX_QUESTION_INDEX),
  questionId: z.number().int().positive().nullable().optional().transform(v => v ?? null),
  chosenOption: z.number().int().min(0).max(19),
  isCorrect: z.boolean(),
  msOnQuestion: z
    .number()
    .finite()
    .transform(v => Math.min(MAX_MS_ON_QUESTION, Math.max(0, Math.round(v)))),
});

const completeSchema = z
  .object({
    type: z.literal('complete'),
    sessionId,
    answeredCount: z.number().int().min(0).max(MAX_QUESTION_INDEX + 1),
    correctCount: z.number().int().min(0).max(MAX_QUESTION_INDEX + 1),
  })
  .refine(v => v.correctCount <= v.answeredCount, { message: 'correctCount 不能大於 answeredCount' });

const profileSchema = z.object({
  type: z.literal('profile'),
  sessionId,
  role: z.enum(PROFILE_ROLES).nullable().optional().transform(v => v ?? null),
  language: z.enum(PROFILE_LANGUAGES).nullable().optional().transform(v => v ?? null),
  examPlan: z.enum(PROFILE_EXAM_PLANS).nullable().optional().transform(v => v ?? null),
});

const leadSchema = z.object({
  type: z.literal('lead'),
  sessionId,
  email: z.string().trim().toLowerCase().max(254).email(),
  // 沒勾同意就不收：必須明確為 true
  consent: z.literal(true),
});

const eventSchema = z.union([sessionStartSchema, answerSchema, completeSchema, profileSchema, leadSchema]);

export type PracticePageEvent = z.infer<typeof eventSchema>;

export type ParsePracticePageEventResult =
  | { ok: true; event: PracticePageEvent }
  | { ok: false; error: string };

// body 用 text 收（sendBeacon 送 text/plain 不會觸發 CORS preflight），這裡自己 JSON.parse
export function parsePracticePageEvent(body: string): ParsePracticePageEventResult {
  if (body.length > MAX_EVENT_BODY_BYTES) {
    return { ok: false, error: 'payload 過大' };
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, error: '不是合法的 JSON' };
  }
  const parsed = eventSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: '事件格式不合法' };
  }
  return { ok: true, event: parsed.data };
}
