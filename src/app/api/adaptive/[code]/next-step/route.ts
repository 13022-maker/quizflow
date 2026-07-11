/**
 * GET /api/adaptive/:code/next-step?student=s01 — 下一步學習活動（ndjson 串流）
 * 一行一個 JSON 事件：
 *   {"type":"delta","text":"…"}   課文生成中的文字增量（僅卡關生成課文時出現）
 *   {"type":"step","step":{…}}    最終結果：item（選項題，已剝除正解）/ lesson / completed
 *   {"type":"error","error":"…"}
 * 非課文情境（派題／完課）沒有 delta，直接收到 step——前端一律走此端點。
 */
import { getServiceByCode, toClientStep, toErrorResponse } from '@/libs/adaptive/service';

import type { AdaptiveService } from '@/libs/adaptive/service';

export async function GET(
  request: Request,
  { params }: { params: { code: string } },
) {
  const studentKey = new URL(request.url).searchParams.get('student')?.trim();
  if (!studentKey) {
    return Response.json({ error: '缺少 ?student= 學號參數' }, { status: 400 });
  }

  let service: AdaptiveService;
  try {
    ({ service } = await getServiceByCode(params.code)); // 練習不存在 → 404，不進入串流
  } catch (error) {
    return toErrorResponse(error);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let clientGone = false; // 客戶端斷線（關分頁）後停止推送，但讓生成繼續完成
      const send = (obj: unknown) => {
        if (clientGone) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          // enqueue 對已關閉的串流拋錯 = 客戶端已斷線；
          // 不中斷生成——課文完成後仍會存入 pendingLesson，重整頁面即可取得
          clientGone = true;
        }
      };
      try {
        // 課文生成的每個文字增量即時推給前端；其餘情況直接得到 step
        const step = await service.layer.getNextStep(studentKey, text =>
          send({ type: 'delta', text }));
        send({ type: 'step', step: toClientStep(step) }); // 剝除正確答案後才回傳
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[adaptive-api] ${new Date().toISOString()} ${message}`);
        send({ type: 'error', error: message });
      } finally {
        if (!clientGone) {
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache',
    },
  });
}
