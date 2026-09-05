import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { filterActiveStudentKeys, parseDateRangeParams } from '@/libs/adaptive/dateRangeFilter';
import { getAdaptiveService } from '@/libs/adaptive/service';
import { db } from '@/libs/DB';
import { adaptivePracticeSchema, adaptiveStudentStateSchema } from '@/models/Schema';

export const runtime = 'nodejs';

// 知識點狀態中文標籤（與班級儀表板頁面 STATUS_META 對齊）
const STATUS_LABEL: Record<string, string> = {
  mastered: '已精熟',
  learning: '學習中',
  locked: '鎖定中',
};

export async function GET(
  request: Request,
  { params }: { params: { practiceId: string } },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  const practiceId = Number(params.practiceId);
  if (!Number.isInteger(practiceId)) {
    return NextResponse.json({ error: '無效的練習 ID' }, { status: 400 });
  }

  const [practice] = await db
    .select()
    .from(adaptivePracticeSchema)
    .where(
      and(
        eq(adaptivePracticeSchema.id, practiceId),
        eq(adaptivePracticeSchema.ownerId, userId),
      ),
    )
    .limit(1);

  if (!practice) {
    return NextResponse.json({ error: '找不到練習或無權限' }, { status: 404 });
  }

  const service = await getAdaptiveService(practice.id, practice.subjectId);
  const states = await service.repo.list();
  const names = await service.repo.getDisplayNames();

  const students = await Promise.all(
    states.map(async s => ({
      studentKey: s.studentId,
      displayName: names.get(s.studentId) ?? s.studentId,
      diagnosis: await service.engine.getDiagnosis(s.studentId),
    })),
  );

  // 日期區間篩選（簡易版，與儀表板頁面 dateRangeFilter.ts 邏輯一致）：
  // 沒帶 ?start=&end= 時 dateRange 為 null，行為與改動前完全相同（匯出全部）
  const { searchParams } = new URL(request.url);
  const dateRange = parseDateRangeParams({
    start: searchParams.get('start') ?? undefined,
    end: searchParams.get('end') ?? undefined,
  });
  const updatedAtRows = await db
    .select({
      studentKey: adaptiveStudentStateSchema.studentKey,
      updatedAt: adaptiveStudentStateSchema.updatedAt,
    })
    .from(adaptiveStudentStateSchema)
    .where(eq(adaptiveStudentStateSchema.practiceId, practice.id));
  const updatedAtByKey = new Map(updatedAtRows.map(r => [r.studentKey, r.updatedAt]));
  const activeKeys = filterActiveStudentKeys(updatedAtByKey, dateRange);
  const visibleStudents = activeKeys
    ? students.filter(s => activeKeys.has(s.studentKey))
    : students;

  // 知識點欄位以第一位學生的診斷排序為準，與儀表板頁面邏輯一致
  // （用未篩選的 students，避免篩選後第一位學生不同導致欄位順序跳動）
  const knowledgeColumns = students[0]?.diagnosis ?? [];

  // 學習後分數＝已解鎖知識點（已精熟＋學習中）的精熟度平均 ×100，排除鎖定中知識點
  const scoredStudents = visibleStudents.map((s) => {
    const unlocked = s.diagnosis.filter(d => d.status !== 'locked');
    return {
      ...s,
      score: unlocked.length > 0
        ? Math.round(
          (unlocked.reduce((sum, d) => sum + d.mastery, 0) / unlocked.length) * 100,
        )
        : null,
      totalAttempts: s.diagnosis.reduce((sum, d) => sum + d.attempts, 0),
    };
  });

  const header = ['姓名', '學號', ...knowledgeColumns.map(k => k.name), '學習後分數', '總作答次數'];
  const rows = scoredStudents.map((s) => {
    const knowledgeCells = s.diagnosis.map(d =>
      `${STATUS_LABEL[d.status] ?? d.status} ${Math.round(d.mastery * 100)}%（作答${d.attempts}次）`,
    );
    return [
      s.displayName,
      s.studentKey,
      ...knowledgeCells,
      s.score === null ? '—' : String(s.score),
      String(s.totalAttempts),
    ];
  });

  const csvContent = [header, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const bom = '\uFEFF';
  const safeTitle = practice.title.replace(/[^a-z0-9\u4E00-\u9FFF]/gi, '_');
  const filename = `${safeTitle}_班級成績.csv`;

  return new Response(bom + csvContent, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
