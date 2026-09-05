/**
 * 班級成績報表產生器 — CSV 匯出、Google Sheet 匯出共用
 * 只負責「撈資料 → 算分數 → 組成 header/rows 表格」，輸出格式（CSV 字串 / Sheets API）
 * 由呼叫端各自決定。
 */
import { eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { adaptiveStudentStateSchema } from '@/models/Schema';

import type { DateRange } from './dateRangeFilter';
import { filterActiveStudentKeys } from './dateRangeFilter';
import { getAdaptiveService } from './service';

// 知識點狀態中文標籤（與班級儀表板頁面 STATUS_META 對齊）
const STATUS_LABEL: Record<string, string> = {
  mastered: '已精熟',
  learning: '學習中',
  locked: '鎖定中',
};

export type ClassScoreReport = {
  header: string[];
  rows: string[][];
};

export async function buildClassScoreReport(
  practice: { id: number; subjectId: string },
  dateRange: DateRange | null,
): Promise<ClassScoreReport> {
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

  // 日期區間篩選（簡易版）：依 updated_at 判斷「這段期間有沒有活動過」
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

  // 知識點欄位以第一位學生的診斷排序為準（用未篩選的 students，避免篩選後
  // 第一位學生不同導致欄位順序跳動）
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

  return { header, rows };
}
