/**
 * POST /api/adaptive/:code/answers — 提交答題（伺服器端判對錯 → BKT 更新與卡關偵測）
 *   body: { "studentKey": "s01", "itemId": "L07", "selectedIndex": 2, "hintsUsed": 0, "responseTimeSec": 45 }
 * 對錯由伺服器比對 answerIndex 判定（前端拿不到答案，無法作弊）；
 * 回傳判題結果（含正解與解析，供作答回饋畫面）與該知識點最新狀態。
 */
import { getServiceByCode, toErrorResponse } from '@/libs/adaptive/service';

type AnswerBody = {
  studentKey?: string;
  itemId?: string;
  selectedIndex?: number;
  hintsUsed?: number;
  responseTimeSec?: number;
};

export async function POST(
  request: Request,
  { params }: { params: { code: string } },
) {
  try {
    const body = (await request.json()) as AnswerBody;
    const studentKey = body.studentKey?.trim();
    if (!studentKey) {
      return Response.json({ error: '缺少必填欄位 studentKey' }, { status: 400 });
    }
    if (!body.itemId || typeof body.itemId !== 'string') {
      return Response.json({ error: '缺少必填欄位 itemId（字串）' }, { status: 400 });
    }
    if (typeof body.selectedIndex !== 'number' || !Number.isInteger(body.selectedIndex)) {
      return Response.json({ error: '缺少必填欄位 selectedIndex（整數）' }, { status: 400 });
    }

    const { service } = await getServiceByCode(params.code);
    const item = service.findItem(body.itemId);
    if (!item) {
      return Response.json({ error: `題目不存在：${body.itemId}` }, { status: 404 });
    }
    if (body.selectedIndex < 0 || body.selectedIndex >= item.options.length) {
      return Response.json(
        { error: `selectedIndex 超出範圍（本題有 ${item.options.length} 個選項）` },
        { status: 400 },
      );
    }

    // 伺服器端判題：比對正解索引
    const isCorrect = body.selectedIndex === item.answerIndex;

    await service.layer.submitAnswer(
      studentKey,
      body.itemId,
      isCorrect,
      body.hintsUsed ?? 0,
      body.responseTimeSec,
    );

    const km = await service.engine.getKnowledgeSnapshot(studentKey, item.knowledgeId);
    return Response.json({
      // 判題結果（作答完才揭露正解與解析）
      isCorrect,
      answerIndex: item.answerIndex,
      explanation: item.explanation,
      // 該知識點最新狀態
      knowledgeId: item.knowledgeId,
      mastery: km.mastery,
      targetDifficulty: km.targetDifficulty,
      attempts: km.attempts,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
