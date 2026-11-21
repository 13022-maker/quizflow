import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createHeartbeatNdjsonStream,
  friendlySubjectUploadError,
  readSubjectGenerationResponse,
  SUBJECT_UPLOAD_NETWORK_ERROR,
} from './subjectGenerationStream';

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

function ndjsonResponse(chunks: string[], init?: ResponseInit): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(encoder.encode(c));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
    ...init,
  });
}

describe('createHeartbeatNdjsonStream', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('生成期間每隔 intervalMs 送一次 ping（避免 iOS Safari 60 秒沒收到資料就斷線）', async () => {
    vi.useFakeTimers();
    let resolveTask!: (v: unknown) => void;
    const task = new Promise((resolve) => {
      resolveTask = resolve;
    });
    const stream = createHeartbeatNdjsonStream(() => task, { intervalMs: 15_000 });
    const textPromise = readAll(stream);

    await vi.advanceTimersByTimeAsync(45_000); // 模擬 AI 生成跑了 45 秒
    resolveTask({ id: 7, name: '網路協定', knowledgeCount: 4, itemCount: 24 });
    await vi.advanceTimersByTimeAsync(0);

    const text = await textPromise;

    expect(text).toBe(
      '{"type":"ping"}\n'
      + '{"type":"ping"}\n'
      + '{"type":"ping"}\n'
      + '{"type":"ping"}\n'
      + '{"type":"result","data":{"id":7,"name":"網路協定","knowledgeCount":4,"itemCount":24}}\n',
    );
  });

  it('task 丟錯：送出 error 行（訊息由 toErrorMessage 轉成老師看得懂的文字）', async () => {
    const stream = createHeartbeatNdjsonStream(
      async () => {
        throw new Error('anthropic 529 overloaded');
      },
      { intervalMs: 15_000, toErrorMessage: () => 'AI 服務暫時無法使用，請稍後再試' },
    );

    const text = await readAll(stream);

    expect(text).toBe(
      '{"type":"ping"}\n{"type":"error","error":"AI 服務暫時無法使用，請稍後再試"}\n',
    );
  });
});

describe('readSubjectGenerationResponse', () => {
  it('串流回應：忽略 ping、回傳 result 的 data（行被切在不同 chunk 也能正確拼回）', async () => {
    const res = ndjsonResponse([
      '{"type":"ping"}\n{"type":"pi',
      'ng"}\n{"type":"result","data":{"id":1,"name":"網路協定",',
      '"knowledgeCount":3,"itemCount":18}}\n',
    ]);

    const data = await readSubjectGenerationResponse(res);

    expect(data).toEqual({ id: 1, name: '網路協定', knowledgeCount: 3, itemCount: 18 });
  });

  it('串流回應：收到 error 行 → 丟出該錯誤訊息', async () => {
    const res = ndjsonResponse(['{"type":"ping"}\n{"type":"error","error":"生成內容過長被截斷，請縮小主題範圍再試"}\n']);

    await expect(readSubjectGenerationResponse(res)).rejects.toThrow('生成內容過長被截斷，請縮小主題範圍再試');
  });

  it('串流在 result 前就結束（例如函式被平台砍掉）→ 丟出友善的中斷訊息', async () => {
    const res = ndjsonResponse(['{"type":"ping"}\n']);

    await expect(readSubjectGenerationResponse(res)).rejects.toThrow(SUBJECT_UPLOAD_NETWORK_ERROR);
  });

  it('一般 JSON 錯誤回應（驗證失敗 400）→ 丟出 route 給的 error', async () => {
    const res = new Response(JSON.stringify({ error: '請輸入單元主題（至少 2 個字）' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });

    await expect(readSubjectGenerationResponse(res)).rejects.toThrow('請輸入單元主題（至少 2 個字）');
  });

  it('非 JSON 的錯誤頁（例如 Vercel 504/413 HTML）→ 不把 SyntaxError 丟給老師，改成友善訊息', async () => {
    const res = new Response('An error occurred with your deployment\n\nFUNCTION_INVOCATION_TIMEOUT', {
      status: 504,
      headers: { 'Content-Type': 'text/plain' },
    });

    await expect(readSubjectGenerationResponse(res)).rejects.toThrow(SUBJECT_UPLOAD_NETWORK_ERROR);
  });
});

describe('friendlySubjectUploadError', () => {
  it('iOS Safari 的 TypeError("Load failed") → 繁中友善訊息', () => {
    expect(friendlySubjectUploadError(new TypeError('Load failed'))).toBe(SUBJECT_UPLOAD_NETWORK_ERROR);
  });

  it('Chrome 的 TypeError("Failed to fetch") → 繁中友善訊息', () => {
    expect(friendlySubjectUploadError(new TypeError('Failed to fetch'))).toBe(SUBJECT_UPLOAD_NETWORK_ERROR);
  });

  it('server 回傳的一般錯誤訊息原樣保留', () => {
    expect(friendlySubjectUploadError(new Error('支援 PDF、圖片格式（jpg/jpeg/png/webp/gif）'))).toBe(
      '支援 PDF、圖片格式（jpg/jpeg/png/webp/gif）',
    );
  });

  it('友善訊息內容', () => {
    expect(SUBJECT_UPLOAD_NETWORK_ERROR).toBe('上傳失敗：檔案過大或網路中斷，請壓縮圖片後再試');
  });
});
