/**
 * AI 生成學科（檔案上傳模式）的長請求傳輸工具。
 *
 * 背景：生成學科要 1～3 分鐘（Opus thinking + 32k tokens + 驗證失敗自動重試一次），
 * 但 iOS Safari 的 fetch 若約 60 秒都沒收到任何回應位元組就會自己斷線，
 * 前端只拿到 TypeError("Load failed")（WebKit bug 165897）。
 * 解法：route 改回傳 NDJSON 串流，生成期間定時送 {"type":"ping"} 心跳讓連線保持活著，
 * 完成後送 {"type":"result","data":...}，失敗送 {"type":"error","error":"..."}。
 * 前端用 readSubjectGenerationResponse 讀取，網路層錯誤用 friendlySubjectUploadError 轉成繁中訊息。
 */

export const SUBJECT_UPLOAD_NETWORK_ERROR = '上傳失敗：檔案過大或網路中斷，請壓縮圖片後再試';

/** 心跳間隔：遠低於 iOS Safari ~60 秒的閒置斷線門檻 */
export const SUBJECT_STREAM_HEARTBEAT_MS = 15_000;

export const NDJSON_CONTENT_TYPE = 'application/x-ndjson; charset=utf-8';

type StreamMessage
  = | { type: 'ping' }
  | { type: 'result'; data: unknown }
  | { type: 'error'; error: string };

/**
 * 把一個耗時的 task 包成 NDJSON 串流：一開始先送一次 ping（讓瀏覽器立刻收到 header + 第一個位元組），
 * 之後每 intervalMs 送一次 ping，task 完成送 result、丟錯送 error，然後關閉串流。
 * 客戶端中途斷線（enqueue 拋錯）時停止推送，但不中斷 task（存檔照樣完成，老師重整清單即可看到）。
 */
export function createHeartbeatNdjsonStream<T>(
  task: () => Promise<T>,
  options: { intervalMs?: number; toErrorMessage?: (err: unknown) => string } = {},
): ReadableStream<Uint8Array> {
  const intervalMs = options.intervalMs ?? SUBJECT_STREAM_HEARTBEAT_MS;
  const toErrorMessage = options.toErrorMessage
    ?? ((err: unknown) => (err instanceof Error ? err.message : String(err)));
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let clientGone = false;
      const send = (msg: StreamMessage) => {
        if (clientGone) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(msg)}\n`));
        } catch {
          clientGone = true;
        }
      };

      send({ type: 'ping' });
      const timer = setInterval(() => send({ type: 'ping' }), intervalMs);
      try {
        const data = await task();
        send({ type: 'result', data });
      } catch (err) {
        send({ type: 'error', error: toErrorMessage(err) });
      } finally {
        clearInterval(timer);
        if (!clientGone) {
          try {
            controller.close();
          } catch {
            // 已關閉就略過
          }
        }
      }
    },
  });
}

/**
 * 讀取 generate-subject-from-file 的回應：
 * - NDJSON 串流：忽略 ping，回傳 result.data；收到 error 行就丟出該訊息；沒等到 result 就結束視為中斷
 * - 一般 JSON（驗證失敗等 4xx）：丟出 route 給的 error
 * - 非 JSON 的錯誤頁（Vercel 413/504 等）：丟出友善訊息，不把 SyntaxError 原文顯示給老師
 */
export async function readSubjectGenerationResponse<T = unknown>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type') ?? '';

  if (!contentType.includes('application/x-ndjson')) {
    let data: { error?: string } | null = null;
    try {
      data = await res.json();
    } catch {
      throw new Error(SUBJECT_UPLOAD_NETWORK_ERROR);
    }
    if (!res.ok) {
      throw new Error(data?.error || '生成失敗');
    }
    return data as T;
  }

  if (!res.body) {
    throw new Error(SUBJECT_UPLOAD_NETWORK_ERROR);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleLine = (line: string): { done: true; data: T } | null => {
    if (!line.trim()) {
      return null;
    }
    let msg: StreamMessage;
    try {
      msg = JSON.parse(line) as StreamMessage;
    } catch {
      throw new Error(SUBJECT_UPLOAD_NETWORK_ERROR);
    }
    if (msg.type === 'result') {
      return { done: true, data: msg.data as T };
    }
    if (msg.type === 'error') {
      throw new Error(msg.error || '生成失敗');
    }
    return null; // ping
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? ''; // 最後一段可能是不完整的行，留到下一輪
    for (const line of lines) {
      const r = handleLine(line);
      if (r) {
        return r.data;
      }
    }
  }
  buffer += decoder.decode();
  const last = handleLine(buffer);
  if (last) {
    return last.data;
  }
  // 串流在送出結果前就結束（函式逾時被砍、連線中斷）
  throw new Error(SUBJECT_UPLOAD_NETWORK_ERROR);
}

/**
 * fetch 本身失敗時瀏覽器丟的是 TypeError（iOS Safari：「Load failed」、Chrome：「Failed to fetch」、
 * Firefox：「NetworkError when attempting to fetch resource.」），訊息對老師沒有意義，換成繁中說明；
 * 其他錯誤（server 回傳的友善訊息）原樣保留。
 */
export function friendlySubjectUploadError(err: unknown): string {
  if (err instanceof TypeError) {
    return SUBJECT_UPLOAD_NETWORK_ERROR;
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return '生成失敗';
}
