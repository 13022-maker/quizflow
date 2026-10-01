// 對錯判斷 + 錯因 題型：學生判斷範例答案「對 / 有錯」，判錯時再從老師給的錯因選項中選一個。
//
// 防洩題設計：不論標準是對或錯，每則範例答案都「必須」有 2–4 個錯因選項（標準為對時是誘答），
// 學生端只拿到選項清單，形狀與對錯無關，無法從「有沒有選項」反推答案。
import { z } from 'zod';

import type { ModeScoreRow, ReviewModeHandler } from './types';

export const JUDGMENT_MIN_REASONS = 2;
export const JUDGMENT_MAX_REASONS = 4;
export const JUDGMENT_REASON_MAX_LENGTH = 40;

export const JudgmentRefSchema = z
  .object({
    isCorrect: z.boolean({ required_error: '請標示這則答案是對還是錯' }),
    reasonOptions: z
      .array(
        z
          .string()
          .trim()
          .min(1, '錯因選項不可空白')
          .max(JUDGMENT_REASON_MAX_LENGTH, `錯因選項最多 ${JUDGMENT_REASON_MAX_LENGTH} 字`),
      )
      .min(JUDGMENT_MIN_REASONS, `錯因選項至少要 ${JUDGMENT_MIN_REASONS} 個（標示為「對」的答案也要填，當作誘答）`)
      .max(JUDGMENT_MAX_REASONS, `錯因選項最多 ${JUDGMENT_MAX_REASONS} 個`),
    correctReasonIndex: z.number().int().nullable(),
  }, { required_error: '請設定這則答案的對錯與錯因選項', invalid_type_error: '請設定這則答案的對錯與錯因選項' })
  .superRefine((ref, ctx) => {
    if (new Set(ref.reasonOptions).size !== ref.reasonOptions.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '錯因選項不可重複', path: ['reasonOptions'] });
    }
    if (ref.isCorrect) {
      if (ref.correctReasonIndex !== null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: '標示為「對」的答案不能指定錯因', path: ['correctReasonIndex'] });
      }
      return;
    }
    if (ref.correctReasonIndex === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '請選定正確的錯因', path: ['correctReasonIndex'] });
      return;
    }
    if (ref.correctReasonIndex < 0 || ref.correctReasonIndex >= ref.reasonOptions.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '正確錯因必須是選項之一', path: ['correctReasonIndex'] });
    }
  });
export type JudgmentRef = z.infer<typeof JudgmentRefSchema>;

export const JudgmentResponseSchema = z
  .object({
    isCorrect: z.boolean({ required_error: '請先判斷這則答案是對還是錯' }),
    reasonIndex: z.number().int().min(0).max(JUDGMENT_MAX_REASONS - 1).nullable(),
  })
  .superRefine((res, ctx) => {
    if (res.isCorrect && res.reasonIndex !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '判斷為「正確」時不需要選錯因', path: ['reasonIndex'] });
    }
    if (!res.isCorrect && res.reasonIndex === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '判斷為「有錯」時請選一個錯因', path: ['reasonIndex'] });
    }
  });
export type JudgmentResponse = z.infer<typeof JudgmentResponseSchema>;

export type JudgmentClientData = { reasonOptions: string[] };

// DB 裡的資料理論上已驗證過；保險起見計分時再 parse 一次，損毀的列當 0 分
function parseRef(refData: unknown): JudgmentRef | null {
  const r = JudgmentRefSchema.safeParse(refData);
  return r.success ? r.data : null;
}

function parseResponses(rows: ModeScoreRow[]): (JudgmentResponse | null)[] {
  return rows.map((row) => {
    const r = JudgmentResponseSchema.safeParse(row.responseData);
    return r.success ? r.data : null;
  });
}

// 單一學生作答的得分比例（0 / 0.5 / 1）
function responseRatio(ref: JudgmentRef, res: JudgmentResponse | null): number {
  if (!res || res.isCorrect !== ref.isCorrect) {
    return 0;
  }
  if (ref.isCorrect) {
    return 1;
  }
  return res.reasonIndex === ref.correctReasonIndex ? 1 : 0.5;
}

export const judgmentHandler: ReviewModeHandler<JudgmentRef, JudgmentResponse> = {
  mode: 'judgment',
  label: '對錯判斷 + 錯因',
  description: '判斷每則範例答案是對還是錯，錯的話選出錯在哪；適合數理計算、選擇題、短答等有明確對錯的答案',
  refSchema: JudgmentRefSchema,
  responseSchema: JudgmentResponseSchema,

  validateSet: (samples) => {
    const hasWrong = samples.some(s => parseRef(s.refData)?.isCorrect === false);
    return hasWrong ? null : '至少要有 1 則範例答案標為「有錯」，全對的題組沒有批閱價值';
  },

  toClientData: (sample): JudgmentClientData => ({
    reasonOptions: parseRef(sample.refData)?.reasonOptions ?? [],
  }),

  // 每位學生各自算比例（判斷錯 0；標準為錯時判錯但錯因錯 0.5），組內平均 × 配分
  calcSampleAccuracy: ({ sample, sampleScores, pointsForSample }) => {
    const ref = parseRef(sample.refData);
    if (!ref || sampleScores.length === 0) {
      return 0;
    }
    const ratios = parseResponses(sampleScores).map(res => responseRatio(ref, res));
    const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    return Math.round(avg * pointsForSample);
  },

  summarize: ({ sample, sampleScores }) => {
    const ref = parseRef(sample.refData);
    if (!ref) {
      return { team: '-', ref: '-' };
    }
    const responses = parseResponses(sampleScores);
    const total = responses.length;
    if (ref.isCorrect) {
      const judgedRight = responses.filter(r => r?.isCorrect === true).length;
      return { team: `判對 ${judgedRight}/${total}`, ref: '對' };
    }
    const judgedWrong = responses.filter(r => r?.isCorrect === false).length;
    const reasonRight = responses.filter(r => r?.isCorrect === false && r.reasonIndex === ref.correctReasonIndex).length;
    return {
      team: `判錯 ${judgedWrong}/${total}・錯因正確 ${reasonRight}/${total}`,
      ref: `錯：${ref.reasonOptions[ref.correctReasonIndex ?? 0] ?? '-'}`,
    };
  },

  aiInstruction: `本題組採「對錯判斷 + 錯因」批閱題型：學生要判斷每則範例答案是「對」還是「有錯」，判錯時再從錯因選項中選出真正的錯因。因此：
1. 範例答案要是有明確對錯的作答（數理計算、選擇題作答附理由、短答等），不要寫成開放式心得；上面「品質差距」與 ref 分數的要求在本題型可以忽略（ref 一律填 0）。
2. 3 則中至少 1 則「有錯」、至少 1 則「正確」。錯的答案要「錯得像真實學生會犯的錯」（例如單位換算錯、漏看題目條件、進位/符號計算錯、把相近概念搞混），不要錯得離譜或一眼就看穿；正確的答案也要像學生寫的，不要完美到一看就知道是標準答案。
3. 每則範例答案都要有 3–4 個「錯因選項」（reasonOptions），每個 2–15 字、彼此要有鑑別度（不能是同義詞），且要貼合這一則的內容。標示為正確的那則也要給錯因選項，當作誘答。
4. 每則 samples 物件多輸出一個 "refData" 欄位：
   - isCorrect：true（正確）或 false（有錯）
   - reasonOptions：錯因選項字串陣列（3–4 個）
   - correctReasonIndex：isCorrect 為 false 時填正確錯因在 reasonOptions 中的索引（從 0 起算）；isCorrect 為 true 時必須填 null
   - 正確錯因在 reasonOptions 中的位置要隨機分散，不要每次都放第一個
範例：
"samples": [
  { "content": "一杯 250 毫升，40 杯就是 250×40=10000 毫升，等於 100 公升。", "ref": { "correctness": 0, "completeness": 0, "clarity": 0, "creativity": 0 }, "refData": { "isCorrect": false, "reasonOptions": ["計算錯誤", "單位換算錯", "漏看條件"], "correctReasonIndex": 1 } },
  { "content": "250×40=10000 毫升，10000÷1000=10 公升，所以要準備 10 公升果汁。", "ref": { "correctness": 0, "completeness": 0, "clarity": 0, "creativity": 0 }, "refData": { "isCorrect": true, "reasonOptions": ["單位換算錯", "計算錯誤", "漏看條件"], "correctReasonIndex": null } },
  { "content": "一杯 250 毫升，40 杯是 250×40=1000 毫升，就是 1 公升。", "ref": { "correctness": 0, "completeness": 0, "clarity": 0, "creativity": 0 }, "refData": { "isCorrect": false, "reasonOptions": ["漏看條件", "單位換算錯", "計算錯誤", "概念誤解"], "correctReasonIndex": 2 } }
]`,
};
