/**
 * AI 出題 API 回非 2xx、且 body 不是我們的 JSON（例如 Vercel 平台逾時回的 504 純文字）時，
 * 前端依狀態碼顯示的訊息。純函式，client / server 都可 import。
 *
 * 踩過的坑（2026-11-18）：generate-from-file 被 Vercel 60 秒砍掉回 504，前端 res.json() 失敗，
 * 老師只看到「命題失敗」，不知道要減少頁數或題數重試。
 */
import { AI_TIMEOUT_MESSAGE } from './aiDeadline';

export { AI_TIMEOUT_MESSAGE };

export function describeAiHttpFailure(status: number): string {
  if (status === 504) {
    return AI_TIMEOUT_MESSAGE;
  }
  if (status === 413) {
    return '上傳的檔案太大，請縮小頁數範圍或壓縮後再試';
  }
  if (status >= 500) {
    return `AI 服務暫時無法回應（HTTP ${status}），請稍後再試`;
  }
  return `命題失敗（HTTP ${status}），請重試`;
}
