/**
 * GET /api/adaptive/:code/diagnosis?student=s01 — 學生各知識點診斷（側欄進度條）
 * 回傳依學習路徑排序的知識點陣列：status = mastered | learning | locked
 */
import { getServiceByCode, toErrorResponse } from '@/libs/adaptive/service';

export async function GET(
  request: Request,
  { params }: { params: { code: string } },
) {
  try {
    const studentKey = new URL(request.url).searchParams.get('student')?.trim();
    if (!studentKey) {
      return Response.json({ error: '缺少 ?student= 學號參數' }, { status: 400 });
    }

    const { service } = await getServiceByCode(params.code);
    return Response.json({
      studentKey,
      diagnosis: await service.engine.getDiagnosis(studentKey),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
