/**
 * 練習頁統計的純函式整形：把 SQL 聚合好的列轉成老師統計頁要顯示的格式。
 * 不碰 DB，方便測試；SQL 聚合本身在 libs/practicePageStatsQuery.ts。
 */

export type AnswerAggRow = {
  questionIndex: number;
  questionId: number | null;
  chosenOption: number;
  isCorrect: boolean;
  count: number;
};

export type QuestionStat = {
  questionIndex: number;
  questionId: number | null;
  attempts: number;
  wrong: number;
  errorRate: number;
  distribution: { option: number; count: number; isCorrect: boolean }[];
  topWrongOption: number | null; // 最多人選的錯誤選項（0-based），全對時為 null
};

export function buildQuestionStats(rows: AnswerAggRow[]): QuestionStat[] {
  const byQuestion = new Map<number, QuestionStat>();

  for (const row of rows) {
    let stat = byQuestion.get(row.questionIndex);
    if (!stat) {
      stat = {
        questionIndex: row.questionIndex,
        questionId: row.questionId,
        attempts: 0,
        wrong: 0,
        errorRate: 0,
        distribution: [],
        topWrongOption: null,
      };
      byQuestion.set(row.questionIndex, stat);
    }
    if (stat.questionId === null && row.questionId !== null) {
      stat.questionId = row.questionId;
    }
    stat.attempts += row.count;
    if (!row.isCorrect) {
      stat.wrong += row.count;
    }
    const existing = stat.distribution.find(d => d.option === row.chosenOption);
    if (existing) {
      existing.count += row.count;
    } else {
      stat.distribution.push({ option: row.chosenOption, count: row.count, isCorrect: row.isCorrect });
    }
  }

  const result = [...byQuestion.values()];
  for (const stat of result) {
    stat.errorRate = stat.attempts > 0 ? stat.wrong / stat.attempts : 0;
    stat.distribution.sort((a, b) => a.option - b.option);
    let top: { option: number; count: number } | null = null;
    for (const d of stat.distribution) {
      if (!d.isCorrect && (!top || d.count > top.count)) {
        top = d;
      }
    }
    stat.topWrongOption = top ? top.option : null;
  }

  return result.sort((a, b) => b.errorRate - a.errorRate || a.questionIndex - b.questionIndex);
}

export type LeadRow = {
  email: string;
  consentAt: Date;
  sessionId: string;
  shareId: number;
};

function csvCell(value: string): string {
  // 開頭是 = + - @ 的儲存格在 Excel/Sheets 會被當公式執行，前面補 ' 擋公式注入
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function leadsToCsv(rows: LeadRow[]): string {
  const lines = ['email,consent_at,session_id,share_id'];
  for (const r of rows) {
    lines.push([r.email, r.consentAt.toISOString(), r.sessionId, String(r.shareId)].map(csvCell).join(','));
  }
  // 加 BOM 讓 Excel 正確辨識 UTF-8
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
