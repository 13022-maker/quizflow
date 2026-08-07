import { z } from 'zod';

/**
 * 學生提交測驗答案的輸入驗證。
 * 從 responseActions.ts 抽出成純模組：
 * 1. 'use server' 檔案只能 export async function，schema 放這裡才能單元測試
 * 2. 驗證失敗回傳友善訊息（而非 throw），production 上 Server Action
 *    throw 的訊息會被 Next.js 遮罩，學生只會看到看不懂的英文 generic 錯誤
 */
export const SubmitSchema = z.object({
  quizId: z.number().int().positive(),
  // trim：手機鍵盤自動選字常在尾端補空格，是 email 驗證失敗最常見原因
  studentName: z.string().trim().max(100).optional(),
  studentEmail: z.string().trim().email().max(200).optional(),
  // { questionId: answer } — answer 是 string（簡答/是非）或 string[]（選擇題/排序題）。
  // 例外：克漏字題會多夾帶 `${questionId}__hints` 這種合成 key（string[]，用過提示的
  // 空格 index），不是真實 question id，見 responseActions.ts 的 cloze 批改分支跟
  // QuizTaker.tsx 的 handleSubmit。這裡的 key 型別若之後想收緊（例如改 z.coerce.number()），
  // 一定要先確認這個例外，不然提示批改會在執行期悄悄壞掉且沒有型別錯誤可以抓。
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  // 考試防作弊：學生離開頁面次數（preventLeave 開啟時才有意義）
  leaveCount: z.number().int().min(0).optional(),
});

export type SubmitInput = z.infer<typeof SubmitSchema>;

export type ParseSubmitResult
  = | { ok: true; data: SubmitInput }
  | { ok: false; error: string };

/** 依驗證失敗的欄位給出學生看得懂的訊息 */
export function parseSubmitInput(data: unknown): ParseSubmitResult {
  const parsed = SubmitSchema.safeParse(data);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }

  const firstIssue = parsed.error.errors[0];
  const field = firstIssue?.path[0];

  if (field === 'studentEmail') {
    return { ok: false, error: 'Email 格式不正確，請修正或留空' };
  }
  if (field === 'studentName') {
    return { ok: false, error: '姓名過長，請縮短後再送出' };
  }
  return { ok: false, error: '提交資料格式錯誤，請重新整理頁面後再試一次' };
}
