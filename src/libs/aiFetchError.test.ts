import { describe, expect, it } from 'vitest';

import { aiErrorMessageForStatus, AiResponseError, droppedQuestionsNotice, readAiResponse } from './aiFetchError';

async function catchError(p: Promise<unknown>): Promise<AiResponseError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AiResponseError) {
      return e;
    }
    throw e;
  }
  throw new Error('預期要丟出 AiResponseError，但沒有');
}

describe('readAiResponse', () => {
  it('成功回應：回傳解析後的 JSON', async () => {
    const res = new Response(JSON.stringify({ title: 'T', questions: [] }), { status: 200 });

    await expect(readAiResponse(res)).resolves.toEqual({ title: 'T', questions: [] });
  });

  it('Vercel 504 純文字 body：顯示逾時中文訊息，不會冒出 Unexpected token', async () => {
    const err = await catchError(readAiResponse(new Response('An error occurred', { status: 504 })));

    expect(err.message).toBe('處理逾時，請減少頁數或題數再試');
    expect(err.status).toBe(504);
  });

  it('408 也當作逾時', async () => {
    const err = await catchError(readAiResponse(new Response('timeout', { status: 408 })));

    expect(err.message).toBe('處理逾時，請減少頁數或題數再試');
  });

  it('413 純文字 body（Request Entity Too Large）：提示檔案太大', async () => {
    const err = await catchError(readAiResponse(new Response('Request Entity Too Large', { status: 413 })));

    expect(err.message).toBe('檔案太大（上限約 4.5MB），請縮小頁數範圍');
  });

  it('429 純文字：請求太頻繁', async () => {
    const err = await catchError(readAiResponse(new Response('Too Many Requests', { status: 429 })));

    expect(err.message).toBe('請求太頻繁，請稍後再試');
  });

  it('其他狀態碼且非 JSON：顯示錯誤碼', async () => {
    const err = await catchError(readAiResponse(new Response('<html>Bad Gateway</html>', { status: 502 })));

    expect(err.message).toBe('命題失敗（錯誤碼 502），請稍後再試');
  });

  it('server 回 JSON { error }：優先顯示 server 的中文訊息（即使是 413）', async () => {
    const res = new Response(JSON.stringify({ error: '此 PDF 共 43 頁，超過上限' }), { status: 413 });
    const err = await catchError(readAiResponse(res));

    expect(err.message).toBe('此 PDF 共 43 頁，超過上限');
  });

  it('server 回 JSON 帶 upgradeRequired：保留旗標給 UI 顯示升級提示', async () => {
    const res = new Response(JSON.stringify({ error: '本月額度已用完', upgradeRequired: true }), { status: 403 });
    const err = await catchError(readAiResponse(res));

    expect(err.message).toBe('本月額度已用完');
    expect(err.upgradeRequired).toBe(true);
  });

  it('JSON 但沒有 error 欄位：退回狀態碼對應訊息', async () => {
    const err = await catchError(readAiResponse(new Response('{}', { status: 500 })));

    expect(err.message).toBe('命題失敗（錯誤碼 500），請稍後再試');
    expect(err.upgradeRequired).toBe(false);
  });

  it('可自訂失敗字首（題庫匯入用「題庫解析失敗」）', async () => {
    const err = await catchError(readAiResponse(new Response('x', { status: 500 }), { failurePrefix: '題庫解析失敗' }));

    expect(err.message).toBe('題庫解析失敗（錯誤碼 500），請稍後再試');
  });

  it('200 但 body 不是 JSON：仍丟出中文錯誤而非 SyntaxError', async () => {
    const err = await catchError(readAiResponse(new Response('<html></html>', { status: 200 })));

    expect(err.message).toBe('命題失敗（伺服器回應格式錯誤），請稍後再試');
  });
});

describe('droppedQuestionsNotice', () => {
  it('dropped > 0：顯示略過題數', () => {
    expect(droppedQuestionsNotice(3)).toBe('AI 產生的題目中有 3 題格式錯誤已略過');
  });

  it('沒有 / 0 / 非數字：null', () => {
    expect(droppedQuestionsNotice(undefined)).toBeNull();
    expect(droppedQuestionsNotice(0)).toBeNull();
    expect(droppedQuestionsNotice('2')).toBeNull();
  });
});

describe('aiErrorMessageForStatus', () => {
  it('對應表', () => {
    expect(aiErrorMessageForStatus(413)).toBe('檔案太大（上限約 4.5MB），請縮小頁數範圍');
    expect(aiErrorMessageForStatus(504)).toBe('處理逾時，請減少頁數或題數再試');
    expect(aiErrorMessageForStatus(429)).toBe('請求太頻繁，請稍後再試');
    expect(aiErrorMessageForStatus(400)).toBe('命題失敗（錯誤碼 400），請稍後再試');
  });
});
