/**
 * POST /api/adaptive/:code/annotations — 課文劃線提問（即時回答，可多輪追問）
 *   body: { "studentKey": "s01", "highlightedText": "for (int i = 1; …)", "question": "為什麼是 5 次？" }
 * 前置條件：學生必須有進行中的補強課文（next-step 回傳 type: "lesson"），否則 409。
 */
import { getServiceByCode, toErrorResponse } from '@/libs/adaptive/service';

type AnnotationBody = {
  studentKey?: string;
  highlightedText?: string;
  question?: string;
};

export async function POST(
  request: Request,
  { params }: { params: { code: string } },
) {
  try {
    const body = (await request.json()) as AnnotationBody;
    const studentKey = body.studentKey?.trim();
    if (!studentKey) {
      return Response.json({ error: '缺少必填欄位 studentKey' }, { status: 400 });
    }
    if (!body.highlightedText || typeof body.highlightedText !== 'string') {
      return Response.json({ error: '缺少必填欄位 highlightedText（字串）' }, { status: 400 });
    }
    if (!body.question || typeof body.question !== 'string') {
      return Response.json({ error: '缺少必填欄位 question（字串）' }, { status: 400 });
    }

    const { service } = await getServiceByCode(params.code);
    const answer = await service.layer.askAnnotation(studentKey, body.highlightedText, body.question);
    return Response.json({ answer });
  } catch (error) {
    return toErrorResponse(error);
  }
}
