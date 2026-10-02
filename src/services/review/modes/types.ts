// 協作批閱「批閱題型」的共用契約。
// 每種題型一個檔案（rubric.ts / judgment.ts / errorSpot.ts / ranking.ts），
// 都實作同一個 ReviewModeHandler，讓 reviewStore / finishGame / API route 只需要
// 依 reviewMode 分派，不用知道各題型細節。
//
// 重要：handler 內全部是純函式（不碰 DB），所以每種題型都能單獨寫 unit test。

import type { z } from 'zod';

import type { RubricScores } from '../scoring';

export const REVIEW_MODES = ['rubric', 'judgment', 'error_spot', 'ranking'] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

export const REVIEW_CREATE_MODES = ['free_text', 'question'] as const;
export type ReviewCreateMode = (typeof REVIEW_CREATE_MODES)[number];

// handler 看到的範例答案（含老師標準答案，server 內部用，絕不能原樣送到學生端）
export type ModeSample = {
  id: number;
  content: string;
  orderIndex: number;
  ref: RubricScores; // rubric 題型用；其他題型一律是 0
  refData: unknown; // 非 rubric 題型的標準答案，已用 refSchema 驗證過才會存進 DB
};

// handler 看到的一筆學生作答（review_score 一列）
export type ModeScoreRow = {
  playerId: number;
  sampleId: number;
  rubric: RubricScores; // rubric 題型用；其他題型一律是 0
  responseData: unknown; // 非 rubric 題型的作答，已用 responseSchema 驗證過才會存進 DB
};

export type ReviewModeHandler<Ref = unknown, Response = unknown> = {
  mode: ReviewMode;
  label: string; // 老師端下拉選單顯示用，例如「對錯判斷 + 錯因」
  description: string; // 一句話說明，顯示在下拉選單下方

  // 老師標準答案的驗證 schema（rubric 題型為 null，沿用 4 個 ref 欄位）
  refSchema: z.ZodType<Ref> | null;
  // 學生作答的驗證 schema（rubric 題型為 null，沿用 4 個 rubric 欄位）
  responseSchema: z.ZodType<Response> | null;

  // 跨範例答案的整組驗證（例如 ranking 的名次必須剛好是 1..N 不重複）。
  // 回傳錯誤訊息（繁中），沒問題回 null。
  validateSet: (samples: { content: string; refData: unknown }[]) => string | null;

  // 給學生端的「公開資料」：必須把標準答案 strip 掉，只留作答需要的東西
  // （例如 error_spot 的句子切分、judgment 的錯因選項）。rubric 回傳 null。
  toClientData: (sample: { content: string; refData: unknown }) => unknown;

  // 單則範例答案的準確度分：整組作答跟標準答案比對，回傳 0..pointsForSample 的整數。
  // sampleScores 只含該則範例答案、該組的作答列；沒有作答時呼叫端不會呼叫（直接算 0）。
  calcSampleAccuracy: (params: {
    sample: ModeSample;
    sampleScores: ModeScoreRow[];
    sampleCount: number; // 整個題組的範例答案數（ranking 需要用來換算名次差距）
    pointsForSample: number;
  }) => number;

  // 老師成果報表用的一行文字摘要：「小組：…」vs「標準：…」
  summarize: (params: { sample: ModeSample; sampleScores: ModeScoreRow[] }) => {
    team: string;
    ref: string;
  };

  // AI 一鍵生成題組時附加在 prompt 尾端的題型說明（要求 AI 每則範例答案多輸出 refData）。
  // rubric 回傳空字串。
  aiInstruction: string;
};
