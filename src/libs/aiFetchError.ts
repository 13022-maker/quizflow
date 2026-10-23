/**
 * aiFetchError.ts — AI 出題 API 回應的統一解析（client 端用）
 *
 * 踩過的坑：Vercel 在 504 逾時 / 413 body 過大時回的是純文字（"An error occurred"、
 * "Request Entity Too Large"），不是 JSON。過去 FileQuizGenerator 先 res.json() 再看
 * res.ok，老師只看到英文「Unexpected token 'A'...」；AIQuizModal 則一律顯示籠統的
 * 「命題失敗」。這裡統一：先看 server 的 JSON { error }，拿不到再依狀態碼給中文提示。
 */

export class AiResponseError extends Error {
  status: number;
  upgradeRequired: boolean;

  constructor(message: string, status: number, upgradeRequired = false) {
    super(message);
    this.name = 'AiResponseError';
    this.status = status;
    this.upgradeRequired = upgradeRequired;
  }
}

export function aiErrorMessageForStatus(status: number, failurePrefix = '命題失敗'): string {
  if (status === 413) {
    return '檔案太大（上限約 4.5MB），請縮小頁數範圍';
  }
  if (status === 504 || status === 408) {
    return '處理逾時，請減少頁數或題數再試';
  }
  if (status === 429) {
    return '請求太頻繁，請稍後再試';
  }
  return `${failurePrefix}（錯誤碼 ${status}），請稍後再試`;
}

type ReadOptions = {
  failurePrefix?: string; // 預設「命題失敗」；題庫匯入可傳「題庫解析失敗」
};

/**
 * 解析 AI API 回應：成功回傳 JSON；失敗丟出帶中文訊息的 AiResponseError。
 * 一律先讀成文字再 JSON.parse，避免非 JSON body 直接冒出 SyntaxError。
 */
export async function readAiResponse<T = any>(res: Response, options: ReadOptions = {}): Promise<T> {
  const failurePrefix = options.failurePrefix ?? '命題失敗';
  const raw = await res.text().catch(() => '');

  let parsed: unknown;
  let isJson = false;
  try {
    parsed = JSON.parse(raw);
    isJson = true;
  } catch {
    // 回應非 JSON（Vercel 平台錯誤頁、純文字等）
  }

  if (!res.ok) {
    const body = (isJson && parsed && typeof parsed === 'object') ? parsed as Record<string, unknown> : {};
    const upgradeRequired = body.upgradeRequired === true;
    const serverMsg = typeof body.error === 'string' && body.error.trim() ? body.error : '';
    throw new AiResponseError(
      serverMsg || aiErrorMessageForStatus(res.status, failurePrefix),
      res.status,
      upgradeRequired,
    );
  }

  if (!isJson) {
    throw new AiResponseError(`${failurePrefix}（伺服器回應格式錯誤），請稍後再試`, res.status);
  }
  return parsed as T;
}

/**
 * server 端可能在成功回應附上 dropped（AI 產生但格式錯誤被略過的題數），
 * 轉成給老師看的提示；沒有或為 0 時回傳 null。
 */
export function droppedQuestionsNotice(dropped: unknown): string | null {
  if (typeof dropped !== 'number' || !Number.isFinite(dropped) || dropped <= 0) {
    return null;
  }
  return `AI 產生的題目中有 ${Math.floor(dropped)} 題格式錯誤已略過`;
}
