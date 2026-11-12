/**
 * 重現「iPhone 上傳截圖生成學科 → ⚠️ Load failed」：
 * 生成學科要 1～3 分鐘，舊 route 在 AI 完成前不送任何位元組（且 maxDuration 只有 60 秒），
 * iOS Safari 約 60 秒收不到資料就斷線。這裡用真實的 iPhone 截圖（PNG 960x2079）跑 route，
 * AI 與存檔 mock 掉（不需要金鑰），驗證：圖片以 image/png 原樣送進模型、回應是會送心跳的串流。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readSubjectGenerationResponse } from '@/libs/adaptive/subjectGenerationStream';

const generateSubjectMock = vi.fn();
const saveGeneratedSubjectMock = vi.fn();

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: 'user_teacher' }),
}));

vi.mock('@/actions/adaptiveActions', () => ({
  saveGeneratedSubject: (...args: unknown[]) => saveGeneratedSubjectMock(...args),
}));

vi.mock('@/libs/adaptive/generate-subject', async () => {
  const { z } = await import('zod');
  return {
    generateSubjectSchema: z.object({ topic: z.string().trim().min(2).max(100) }),
    friendlyAIGenerationError: () => 'AI 服務暫時無法使用，請稍後再試',
    generateSubject: (...args: unknown[]) => generateSubjectMock(...args),
  };
});

// 用 repo 內的 fixture（老師實際上傳的 IMG_2998.PNG，741.9 KB）
const FIXTURE = path.join(__dirname, '__fixtures__', 'iphone-screenshot.png');

function buildRequest(): Request {
  const bytes = readFileSync(FIXTURE);
  const fd = new FormData();
  fd.append('topic', '網路協定');
  fd.append('file', new File([bytes], 'IMG_2998.PNG', { type: 'image/png' }));
  return new Request('http://localhost/api/ai/generate-subject-from-file', { method: 'POST', body: fd });
}

describe('POST /api/ai/generate-subject-from-file（iPhone PNG 截圖）', () => {
  beforeEach(() => {
    generateSubjectMock.mockReset();
    saveGeneratedSubjectMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('maxDuration 至少 180 秒（生成約需 1～3 分鐘，60 秒會被 Vercel 砍掉）', async () => {
    const mod = await import('./route');

    expect(mod.maxDuration).toBeGreaterThanOrEqual(180);
  });

  it('圖片以 image/png 原樣送進模型，生成期間持續送心跳，最後拿到存檔結果', async () => {
    vi.useFakeTimers();
    const { POST } = await import('./route');
    const fileBytes = readFileSync(FIXTURE);

    let finishAI!: (v: unknown) => void;
    generateSubjectMock.mockReturnValue(new Promise((resolve) => {
      finishAI = resolve;
    }));
    saveGeneratedSubjectMock.mockResolvedValue({ id: 42, name: '網路協定', knowledgeCount: 4, itemCount: 24 });

    const res = await POST(buildRequest());

    // AI 還沒完成，route 就必須已經回應 200 串流（瀏覽器立刻收到 header）
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const first = await reader.read();

    expect(decoder.decode(first.value)).toBe('{"type":"ping"}\n');

    await vi.advanceTimersByTimeAsync(90_000); // 模擬 AI 跑了 90 秒（舊版此時連線早已被 iOS 斷掉）
    finishAI({ name: '網路協定' });
    await vi.advanceTimersByTimeAsync(0);

    let rest = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      rest += decoder.decode(value, { stream: true });
    }

    // 90 秒內每 15 秒一次心跳：15/30/45/60/75/90 共 6 次，之後才是結果
    expect(rest.split('\n').filter(l => l === '{"type":"ping"}')).toHaveLength(6);

    const result = await readSubjectGenerationResponse(
      new Response(rest, { headers: { 'Content-Type': 'application/x-ndjson' } }),
    );

    expect(result).toEqual({ id: 42, name: '網路協定', knowledgeCount: 4, itemCount: 24 });

    const [topic, material, media] = generateSubjectMock.mock.calls[0]!;

    expect(topic).toBe('網路協定');
    expect(material).toBeUndefined();
    expect(media).toHaveLength(1);
    expect(media[0].mimeType).toBe('image/png');
    expect(media[0].base64).toBe(fileBytes.toString('base64'));
  });

  it('AI 失敗：串流送出 error 行，前端讀到友善訊息', async () => {
    const { POST } = await import('./route');
    generateSubjectMock.mockRejectedValue(new Error('anthropic overloaded'));
    // route 會 console.error 記錄原始錯誤（給 Vercel logs），測試裡靜音
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(buildRequest());

    await expect(readSubjectGenerationResponse(res)).rejects.toThrow('AI 服務暫時無法使用，請稍後再試');
    expect(saveGeneratedSubjectMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });

  it('沒填主題：仍回一般 JSON 400（驗證錯誤不必串流）', async () => {
    const { POST } = await import('./route');
    const fd = new FormData();
    fd.append('topic', '');
    fd.append('file', new File([readFileSync(FIXTURE)], 'IMG_2998.PNG', { type: 'image/png' }));

    const res = await POST(new Request('http://localhost/x', { method: 'POST', body: fd }));

    expect(res.status).toBe(400);
    await expect(readSubjectGenerationResponse(res)).rejects.toThrow('請輸入單元主題（至少 2 個字）');
  });
});
