/**
 * POST /api/adaptive/:code/lesson-complete — 學生點「我讀完了」
 *   body: { "studentKey": "s01" }
 * 依本篇累積的劃線問答套用 BKT 學習轉移、解除課文門檻。
 * 回傳最新診斷；前端下一步應再呼叫 next-step（會恢復派題）。
 */
import { getServiceByCode, toErrorResponse } from '@/libs/adaptive/service';

export async function POST(
  request: Request,
  { params }: { params: { code: string } },
) {
  try {
    const body = (await request.json()) as { studentKey?: string };
    const studentKey = body.studentKey?.trim();
    if (!studentKey) {
      return Response.json({ error: '缺少必填欄位 studentKey' }, { status: 400 });
    }

    const { service } = await getServiceByCode(params.code);
    await service.layer.completeLesson(studentKey);
    return Response.json({ diagnosis: await service.engine.getDiagnosis(studentKey) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
