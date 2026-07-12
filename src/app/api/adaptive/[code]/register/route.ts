/**
 * POST /api/adaptive/:code/register — 學生加入練習（免登入，冪等）
 *   body: { "studentKey": "s01", "displayName": "王小明" }
 * 同學號重複註冊＝續學（進度不重置，姓名更新為最新填寫）。
 * :code 為分享碼（accessCode），公開路由（middleware 白名單）。
 */
import { getServiceByCode, toErrorResponse } from '@/libs/adaptive/service';

type RegisterBody = {
  studentKey?: string;
  displayName?: string;
};

export async function POST(
  request: Request,
  { params }: { params: { code: string } },
) {
  try {
    const body = (await request.json()) as RegisterBody;
    const studentKey = body.studentKey?.trim();
    const displayName = body.displayName?.trim();
    if (!studentKey || studentKey.length > 30) {
      return Response.json({ error: '請輸入學號（30 字以內）' }, { status: 400 });
    }
    if (!displayName || displayName.length > 30) {
      return Response.json({ error: '請輸入姓名（30 字以內）' }, { status: 400 });
    }

    const { practice, service } = await getServiceByCode(params.code);
    const isReturning = (await service.repo.get(studentKey)) !== undefined;
    await service.engine.registerStudent(studentKey); // 冪等：舊生直接沿用狀態
    await service.repo.setDisplayName(studentKey, displayName); // 覆蓋 save() 的佔位姓名

    return Response.json(
      {
        studentKey,
        displayName,
        practice: { title: practice.title, subjectName: service.subject.name },
        isReturning, // true = 舊生續學
        diagnosis: await service.engine.getDiagnosis(studentKey),
      },
      { status: isReturning ? 200 : 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
