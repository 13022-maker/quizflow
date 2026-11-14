/**
 * AI 出題 NDJSON 串流回應（generate-questions / generate-from-file 共用）
 *
 * 每行一個 JSON 事件：
 *   {"type":"title","title":"..."}
 *   {"type":"question","question":{...}}
 *   {"type":"warning","message":"..."}
 *   {"type":"error","error":"..."}
 *   {"type":"done","count":N,"model":"..."}
 *
 * 流程：
 * 1. primary（Gemini 串流）邊生邊吐，每完成一題就推一行
 * 2. primary 已吐出部分題目後才中斷 → 保留已出題目 + warning，不重出（避免老師看到的題目整批被換掉）
 * 3. primary 一題都沒出（或沒有 primary）→ 走 fallback（非串流），拿到後一次推完
 */

import { QuestionStreamParser } from './questionStreamParser';

export type StreamChunk = {
  text?: string;
  candidates?: { finishReason?: string }[];
};

type Question = Record<string, any>;

export type QuestionNdjsonOptions = {
  logTag: string;
  /** 串流來源（通常是 Gemini generateContentStream）；不給就直接走 fallback */
  primary?: () => Promise<AsyncIterable<StreamChunk>>;
  /** done 事件裡 primary 的模型名稱（預設 'primary'） */
  primaryModel?: string;
  /** primary 失敗且一題都沒出時的備援，回傳完整原始文字 */
  fallback?: () => Promise<{ raw: string; usedModel: string }>;
  /** primary 的錯誤是否該走 fallback（預設一律走） */
  shouldFallback?: (err: unknown) => boolean;
  postProcess: (q: Question) => Question;
  errorMessage: (err: unknown) => string;
};

class FormatError extends Error {}

/** 從 AI 回傳文字中抓出 JSON（Claude 有時會在 JSON 前後多包說明文字） */
export function extractJsonResult(raw: string): { title?: string; questions?: Question[] } {
  const match = raw.match(/\{[\s\S]*\}/);
  try {
    return JSON.parse(match ? match[0] : raw);
  } catch {
    throw new FormatError('AI 回傳格式錯誤，請重試');
  }
}

export function questionNdjsonResponse(opts: QuestionNdjsonOptions): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      let emitted = 0;
      let titleSent = false;
      let primaryError: unknown = null;

      try {
        if (opts.primary) {
          try {
            const parser = new QuestionStreamParser();
            let finishReason: string | undefined;
            for await (const chunk of await opts.primary()) {
              const fr = chunk.candidates?.[0]?.finishReason;
              if (fr) {
                finishReason = fr;
              }
              const { title, questions } = parser.push(chunk.text ?? '');
              if (title !== undefined && !titleSent) {
                titleSent = true;
                send({ type: 'title', title });
              }
              for (const q of questions) {
                send({ type: 'question', question: opts.postProcess(q) });
                emitted++;
              }
            }
            if (finishReason && finishReason !== 'STOP') {
              throw new Error(`STREAM_${finishReason}`);
            }
            if (emitted === 0) {
              throw new Error('STREAM_EMPTY');
            }
            send({ type: 'done', count: emitted, model: opts.primaryModel ?? 'primary' });
            return;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (emitted > 0) {
              console.warn(`[${opts.logTag}] 串流中斷（已出 ${emitted} 題）：${msg}`);
              send({ type: 'warning', message: `AI 輸出中斷，已保留前 ${emitted} 題，可再補出題目` });
              send({ type: 'done', count: emitted, model: opts.primaryModel ?? 'primary' });
              return;
            }
            primaryError = err;
            const canFallback = opts.fallback && (opts.shouldFallback?.(err) ?? true);
            if (!canFallback) {
              throw err;
            }
            console.warn(`[${opts.logTag}] 串流失敗，改走備援：${msg}`);
          }
        }

        if (!opts.fallback) {
          throw primaryError ?? new Error('沒有可用的 AI 模型');
        }
        const { raw, usedModel } = await opts.fallback();
        const result = extractJsonResult(raw);
        if (!titleSent && result.title) {
          send({ type: 'title', title: result.title });
        }
        for (const q of result.questions ?? []) {
          send({ type: 'question', question: opts.postProcess(q) });
          emitted++;
        }
        send({ type: 'done', count: emitted, model: usedModel });
      } catch (err) {
        const error = err instanceof FormatError ? err.message : opts.errorMessage(err);
        console.error(`[${opts.logTag}] 命題失敗：`, err);
        send({ type: 'error', error });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
